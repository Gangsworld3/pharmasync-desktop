import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import { appendLocalOperation, ensureDeviceState, updateLocalOperation } from "../src/db/repositories/syncRepo.js";
import { pushPendingChanges } from "../src/services/sync-engine.js";
import { mapConflict } from "../src/services/sync-conflict-adapter.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";
import { computeNextRetry, getDeferredState, shouldRetry } from "../src/services/sync-retry-scheduler.js";
import { transition } from "../src/services/sync-state-machine.js";
import { evaluatePushResult } from "../src/domain/sync/sync-decision-engine.js";

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

test("retry scheduler snapshot parity stays stable", serial, async () => {
  const now = new Date("2026-03-29T12:00:00.000Z");
  const operation = {
    operationId: "snapshot-op-1",
    idempotencyKey: "snapshot-op-1",
    status: "RETRY_SCHEDULED",
    attempts: 2,
    backoffMs: 5000,
    lastAttemptAt: "2026-03-29T11:59:55.000Z",
    nextAttemptAt: "2026-03-29T12:00:10.000Z"
  };
  const config = { retryBaseMs: 2500, retryMaxMs: 300000 };

  const snapshot = {
    backoffMs: computeNextRetry(operation, config),
    retryEligible: shouldRetry(operation, now, config),
    deferredState: getDeferredState(operation, now, config)
  };

  assert.deepEqual(snapshot, {
    backoffMs: 10000,
    retryEligible: false,
    deferredState: {
      operationId: "snapshot-op-1",
      idempotencyKey: "snapshot-op-1",
      status: "RETRY_SCHEDULED",
      attempts: 2,
      backoffMs: 5000,
      lastAttemptAt: "2026-03-29T11:59:55.000Z",
      nextAttemptAt: "2026-03-29T12:00:10.000Z",
      remainingMs: 10000
    }
  });
});

test("state machine transition table parity remains stable", serial, async () => {
  const now = new Date("2026-03-29T12:00:00.000Z");
  const operation = { attempts: 1, backoffMs: 5000 };

  assert.equal(transition(operation, "START_ATTEMPT", { now }).nextState, "IN_PROGRESS");
  assert.equal(transition(operation, "APPLIED", { now }).nextState, "SYNCED");
  assert.equal(transition(operation, "IDEMPOTENT_REPLAY", { now }).nextState, "SYNCED");
  assert.equal(transition(operation, "CONFLICT", { now }).nextState, "CONFLICT");
  assert.equal(
    transition(operation, "FAIL", { now, reason: "x", config: { retryBaseMs: 2500, retryMaxMs: 300000 }, maxAttempts: 8 }).nextState,
    "RETRY_SCHEDULED"
  );
  assert.equal(
    transition({ attempts: 7, backoffMs: 5000 }, "FAIL", { now, reason: "x", config: { retryBaseMs: 2500, retryMaxMs: 300000 }, maxAttempts: 8 }).nextState,
    "DEAD_LETTER"
  );
});

test("conflict adapter payload snapshot parity remains stable", serial, async () => {
  const payload = mapConflict(
    {
      type: "INSUFFICIENT_STOCK",
      resolution: "Manual resolution required",
      serverRevision: 20,
      local: { data: { quantity_on_hand: 5, sku: "S1" } },
      server: { quantity_on_hand: 2, sku: "S1" }
    },
    {
      localRevision: 10,
      payloadJson: JSON.stringify({ quantity_on_hand: 5, sku: "S1" })
    }
  );

  assert.deepEqual(payload, {
    type: "INSUFFICIENT_STOCK",
    resolution: "Manual resolution required",
    serverRevision: 20,
    local: { data: { quantity_on_hand: 5, sku: "S1" } },
    server: { quantity_on_hand: 2, sku: "S1" },
    localVersion: 10,
    serverVersion: 20,
    fieldDiff: { quantity_on_hand: [5, 2] }
  });
});

test("extracted sync modules remain pure (no fetch/db side effects)", serial, async () => {
  const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const files = [
    "src/services/sync-retry-scheduler.js",
    "src/services/sync-state-machine.js",
    "src/services/sync-conflict-adapter.js"
  ];
  const forbiddenPatterns = [
    /fetch\s*\(/,
    /updateLocalOperation/,
    /from\s+["']\.\.\/db\//,
    /from\s+["']\.\.\/\.\.\/db\//
  ];

  for (const relPath of files) {
    const fullPath = path.join(rootDir, relPath);
    const source = fs.readFileSync(fullPath, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${relPath} violates purity rule: ${pattern}`);
    }
  }
});

test("domain decision engine maps push outcomes deterministically", serial, async () => {
  const now = new Date("2026-03-30T00:00:00.000Z");
  const baseOperation = {
    id: "op-1",
    operationId: "op-1",
    entityId: "inv-1",
    localRevision: 3,
    attempts: 1,
    backoffMs: 2500,
    payloadJson: JSON.stringify({ quantity_on_hand: 5 })
  };

  const applied = evaluatePushResult({
    rawOperation: baseOperation,
    result: { status: "APPLIED" },
    conflicts: [],
    runtimeConfig: { maxOperationAttempts: 8, retryBaseMs: 2500, retryMaxMs: 300000 },
    defaultMaxOperationAttempts: 8,
    sanitizePositiveNumber: (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback),
    mapConflict,
    now
  });
  assert.equal(applied.transitionEvent, "APPLIED");

  const conflict = evaluatePushResult({
    rawOperation: baseOperation,
    result: { status: "CONFLICT" },
    conflicts: [{
      entityId: "inv-1",
      local: { operationId: "op-1", data: { quantity_on_hand: 5 } },
      server: { quantity_on_hand: 2 }
    }],
    runtimeConfig: { maxOperationAttempts: 8, retryBaseMs: 2500, retryMaxMs: 300000 },
    defaultMaxOperationAttempts: 8,
    sanitizePositiveNumber: (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback),
    mapConflict,
    now
  });
  assert.equal(conflict.transitionEvent, "CONFLICT");
  assert.deepEqual(conflict.transitionContext.conflictPayload.fieldDiff?.quantity_on_hand, [5, 2]);

  const retry = evaluatePushResult({
    rawOperation: baseOperation,
    result: { status: "REJECTED", error: "Remote rejection" },
    conflicts: [],
    runtimeConfig: { maxOperationAttempts: 8, retryBaseMs: 2500, retryMaxMs: 300000 },
    defaultMaxOperationAttempts: 8,
    sanitizePositiveNumber: (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback),
    mapConflict,
    now
  });
  assert.equal(retry.transitionEvent, "FAIL");
  assert.equal(retry.transitionContext.reason, "Remote rejection");
});
