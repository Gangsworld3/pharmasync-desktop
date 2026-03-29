import test from "node:test";
import assert from "node:assert/strict";

import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import { appendLocalOperation, ensureDeviceState, updateLocalOperation } from "../src/db/repositories.js";
import { pushPendingChanges } from "../src/services/sync-engine.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";

async function resetLocalOperations() {
  await prisma.localOperation.deleteMany();
}

async function seedOperation(operationId) {
  return appendLocalOperation({
    operationId,
    entityType: "InventoryItem",
    entityId: "inv-test-1",
    operation: "UPDATE",
    localRevision: 1,
    payload: {
      sku: "SKU-TEST-1",
      quantity_on_hand: 5
    },
    status: "PENDING"
  });
}

test("schedules retry deterministically on transient push failure", async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  await seedOperation("op-transient-retry");
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    await assert.rejects(pushPendingChanges);
    const op = await prisma.localOperation.findUnique({ where: { operationId: "op-transient-retry" } });
    assert.ok(op);
    assert.equal(op.status, "RETRY_SCHEDULED");
    assert.ok(op.nextAttemptAt instanceof Date);
    assert.ok(op.backoffMs > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("moves operation to dead-letter after max attempts", async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  const op = await seedOperation("op-dead-letter");
  await updateLocalOperation(op.id, {
    attempts: 1,
    backoffMs: 2000,
    status: "RETRY_SCHEDULED"
  });
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });
  process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS = "2";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    await assert.rejects(pushPendingChanges);
    const latest = await prisma.localOperation.findUnique({ where: { operationId: "op-dead-letter" } });
    assert.ok(latest);
    assert.equal(latest.status, "DEAD_LETTER");
    assert.ok(latest.deadLetteredAt instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS;
  }
});

test("enriches conflict payload with field diff metadata", async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  await seedOperation("op-conflict-diff");
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sync/push")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            results: [{ operationId: "op-conflict-diff", status: "CONFLICT" }],
            conflicts: [{
              entityId: "inv-test-1",
              local: { operationId: "op-conflict-diff", data: { quantity_on_hand: 5 } },
              server: { quantity_on_hand: 2 },
              type: "INSUFFICIENT_STOCK",
              resolution: "Server inventory is lower"
            }],
            serverChanges: []
          },
          meta: { revision: 10 }
        })
      };
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  try {
    const result = await pushPendingChanges();
    assert.equal(result.resultSummary.conflict, 1);
    const op = await prisma.localOperation.findUnique({ where: { operationId: "op-conflict-diff" } });
    assert.ok(op);
    assert.equal(op.status, "CONFLICT");
    const payload = JSON.parse(op.conflictPayloadJson);
    assert.deepEqual(payload.fieldDiff?.quantity_on_hand, [5, 2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
