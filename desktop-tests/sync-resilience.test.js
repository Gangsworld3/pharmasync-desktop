import test from "node:test";
import assert from "node:assert/strict";

import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import { appendLocalOperation, ensureDeviceState, updateLocalOperation } from "../src/db/repositories.js";
import { pushPendingChanges } from "../src/services/sync-engine.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";

const serial = { concurrency: false };

async function resetLocalOperations() {
  await prisma.localOperation.deleteMany();
}

function uniqueOperationId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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

test("schedules retry deterministically on transient push failure", serial, async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  const operationId = uniqueOperationId("op-transient-retry");
  await seedOperation(operationId);
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    await assert.rejects(pushPendingChanges);
    const op = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.ok(op);
    assert.equal(op.status, "RETRY_SCHEDULED");
    assert.ok(op.nextAttemptAt instanceof Date);
    assert.ok(op.backoffMs > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("moves operation to dead-letter after max attempts", serial, async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  const operationId = uniqueOperationId("op-dead-letter");
  const op = await seedOperation(operationId);
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
    const latest = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.ok(latest);
    assert.equal(latest.status, "DEAD_LETTER");
    assert.ok(latest.deadLetteredAt instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS;
  }
});

test("enriches conflict payload with field diff metadata", serial, async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  const operationId = uniqueOperationId("op-conflict-diff");
  await seedOperation(operationId);
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sync/push")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            results: [{ operationId, status: "CONFLICT" }],
            conflicts: [{
              entityId: "inv-test-1",
              local: { operationId, data: { quantity_on_hand: 5 } },
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
    const op = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.ok(op);
    assert.equal(op.status, "CONFLICT");
    const payload = JSON.parse(op.conflictPayloadJson);
    assert.deepEqual(payload.fieldDiff?.quantity_on_hand, [5, 2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps retry-scheduled operations deferred until nextAttemptAt", serial, async () => {
  await ensureDeviceState();
  await resetLocalOperations();
  const operationId = uniqueOperationId("op-deferred");
  const op = await seedOperation(operationId);
  const futureAttemptAt = new Date(Date.now() + 60_000);
  await updateLocalOperation(op.id, {
    status: "RETRY_SCHEDULED",
    attempts: 1,
    backoffMs: 60_000,
    nextAttemptAt: futureAttemptAt
  });
  saveDesktopSession({ accessToken: "test-access-token", email: "tester@example.com" });

  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called for deferred operation");
  };

  try {
    const result = await pushPendingChanges();
    assert.equal(called, false);
    assert.equal(result.pushed, 0);
    assert.equal(result.deferred, 1);
    assert.equal(result.deferredOperations.length, 1);
    assert.equal(result.deferredOperations[0].operationId, operationId);
    assert.equal(result.deferredOperations[0].status, "RETRY_SCHEDULED");
    assert.ok(result.deferredOperations[0].nextAttemptAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
