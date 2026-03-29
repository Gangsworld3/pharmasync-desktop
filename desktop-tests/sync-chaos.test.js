import test from "node:test";
import assert from "node:assert/strict";

import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import {
  appendLocalOperation,
  ensureDeviceState,
  recoverInProgressLocalOperations,
  updateLocalOperation
} from "../src/db/repositories.js";
import { resolveDesktopConflict } from "../src/services/offline-service.js";
import { getSyncEngineStatus, pushPendingChanges, runSyncCycle } from "../src/services/sync-engine.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";

const serial = { concurrency: false };

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function conflictPayloadFor(operationId, entityId = "inv-chaos-1") {
  return {
    data: {
      results: [{ operationId, status: "CONFLICT" }],
      conflicts: [{
        entityId,
        local: { operationId, data: { quantity_on_hand: 8, sale_price_minor: 2000 } },
        server: { quantity_on_hand: 4, sale_price_minor: 2500, server_revision: 44 },
        serverRevision: 44,
        type: "INSUFFICIENT_STOCK",
        resolution: "Server has lower stock and updated pricing"
      }],
      serverChanges: []
    },
    meta: { revision: 44 }
  };
}

async function resetState() {
  await prisma.localOperation.deleteMany();
  await prisma.deviceState.deleteMany();
  await ensureDeviceState();
  saveDesktopSession({ accessToken: "chaos-test-token", email: "chaos@test.local" });
}

async function seedOperation(operationId, createdAtOffsetMs = 0) {
  const createdAt = new Date(Date.now() + createdAtOffsetMs);
  const row = await appendLocalOperation({
    operationId,
    entityType: "InventoryItem",
    entityId: "inv-chaos-1",
    operation: "UPDATE",
    localRevision: 1,
    payload: {
      sku: "CHAOS-SKU-1",
      quantity_on_hand: 8,
      sale_price_minor: 2000
    },
    status: "PENDING"
  });

  await prisma.localOperation.update({
    where: { id: row.id },
    data: { createdAt, updatedAt: createdAt }
  });

  return row;
}

function uniqueOperationId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

test("chaos: network cut mid-batch preserves partial progress and resumes without duplicates", serial, async () => {
  await resetState();
  process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE = "2";
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "1";

  const op1 = uniqueOperationId("op-cut-1");
  const op2 = uniqueOperationId("op-cut-2");
  const op3 = uniqueOperationId("op-cut-3");
  const op4 = uniqueOperationId("op-cut-4");

  await seedOperation(op1, -3000);
  await seedOperation(op2, -2000);
  await seedOperation(op3, -1000);
  await seedOperation(op4, 0);

  const postedOperationBatches = [];
  let pushCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/sync/push")) {
      pushCalls += 1;
      const body = JSON.parse(init.body);
      postedOperationBatches.push(body.changes.map((change) => change.operationId));
      if (pushCalls === 1) {
        return jsonResponse(200, {
          data: {
            results: body.changes.map((change) => ({ operationId: change.operationId, status: "APPLIED" })),
            conflicts: [],
            serverChanges: []
          },
          meta: { revision: 10 }
        });
      }
      throw new TypeError("fetch failed: simulated cable cut");
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await assert.rejects(pushPendingChanges);
    const rows = await prisma.localOperation.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(rows.filter((row) => row.status === "SYNCED").length, 2);
    assert.equal(rows.filter((row) => row.status === "RETRY_SCHEDULED").length, 2);
    await prisma.localOperation.updateMany({
      where: { status: "RETRY_SCHEDULED" },
      data: { nextAttemptAt: new Date() }
    });

    globalThis.fetch = async (url, init = {}) => {
      if (!String(url).includes("/sync/push")) {
        throw new Error(`Unexpected URL: ${url}`);
      }
      const body = JSON.parse(init.body);
      postedOperationBatches.push(body.changes.map((change) => change.operationId));
      return jsonResponse(200, {
        data: {
          results: body.changes.map((change) => ({ operationId: change.operationId, status: "APPLIED" })),
          conflicts: [],
          serverChanges: []
        },
        meta: { revision: 12 }
      });
    };

    await pushPendingChanges();
    const finalRows = await prisma.localOperation.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(finalRows.filter((row) => row.status === "SYNCED").length, 4);
    assert.deepEqual(postedOperationBatches[0], [op1, op2]);
    assert.deepEqual(postedOperationBatches[1], [op3, op4]);
    assert.deepEqual(postedOperationBatches[2], [op3, op4]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE;
    delete process.env.PHARMASYNC_SYNC_REQUEST_RETRIES;
  }
});

test("chaos: periodic 500 failures backoff internally and complete ordered sync safely", serial, async () => {
  await resetState();
  process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE = "1";
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "4";

  const op1 = uniqueOperationId("op-500-1");
  const op2 = uniqueOperationId("op-500-2");
  const op3 = uniqueOperationId("op-500-3");
  await seedOperation(op1, -3000);
  await seedOperation(op2, -2000);
  await seedOperation(op3, -1000);

  let requestCount = 0;
  const pushedInOrder = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    requestCount += 1;
    const body = JSON.parse(init.body);
    const opId = body.changes[0].operationId;
    pushedInOrder.push(opId);

    if (requestCount % 3 === 0) {
      return jsonResponse(500, { error: "simulated transient 500" });
    }

    return jsonResponse(200, {
      data: {
        results: [{ operationId: opId, status: "APPLIED" }],
        conflicts: [],
        serverChanges: []
      },
      meta: { revision: 20 }
    });
  };

  try {
    await pushPendingChanges();
    const rows = await prisma.localOperation.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(rows.filter((row) => row.status === "SYNCED").length, 3);
    assert.deepEqual([...new Set(pushedInOrder)].slice(0, 3), [op1, op2, op3]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE;
    delete process.env.PHARMASYNC_SYNC_REQUEST_RETRIES;
  }
});

test("chaos: high latency timeout schedules retry and surfaces backoff state", serial, async () => {
  await resetState();
  process.env.PHARMASYNC_SYNC_REQUEST_TIMEOUT_MS = "60";
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "1";

  const operationId = uniqueOperationId("op-timeout-1");
  await seedOperation(operationId);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(jsonResponse(200, {
        data: { results: [{ operationId, status: "APPLIED" }], conflicts: [], serverChanges: [] },
        meta: { revision: 30 }
      })), 500);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  };

  try {
    const cycle = await runSyncCycle();
    assert.equal(cycle.status, "error");
    const op = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.ok(op);
    assert.equal(op.status, "RETRY_SCHEDULED");
    assert.equal(op.deadLetteredAt, null);
    const status = await getSyncEngineStatus();
    assert.ok((status.retryBackoffMs ?? 0) > 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_REQUEST_TIMEOUT_MS;
    delete process.env.PHARMASYNC_SYNC_REQUEST_RETRIES;
  }
});

test("chaos: server conflict injection produces enriched metadata and UX actions remain functional", serial, async () => {
  await resetState();
  const operationId = uniqueOperationId("op-conflict-chaos");
  await seedOperation(operationId);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sync/push")) {
      return jsonResponse(200, conflictPayloadFor(operationId));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await pushPendingChanges();
    const conflictOp = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.ok(conflictOp);
    assert.equal(conflictOp.status, "CONFLICT");
    const payload = JSON.parse(conflictOp.conflictPayloadJson);
    assert.equal(payload.localVersion, 1);
    assert.equal(payload.serverVersion, 44);
    assert.deepEqual(payload.fieldDiff.quantity_on_hand, [8, 4]);
    assert.deepEqual(payload.fieldDiff.sale_price_minor, [2000, 2500]);

    const deferred = await resolveDesktopConflict(conflictOp.id, { action: "DEFER" }, "chaos-test");
    assert.equal(deferred.status, "deferred");
    const accepted = await resolveDesktopConflict(conflictOp.id, { action: "ACCEPT_SERVER" }, "chaos-test");
    assert.equal(accepted.status, "resolved");

    const retryOperationId = uniqueOperationId("op-conflict-chaos-retry");
    await seedOperation(retryOperationId);
    await prisma.localOperation.update({
      where: { operationId: retryOperationId },
      data: {
        status: "CONFLICT",
        conflictPayloadJson: JSON.stringify(conflictPayloadFor(retryOperationId).data.conflicts[0]),
        errorDetail: null
      }
    });
    const retryConflict = await prisma.localOperation.findUnique({ where: { operationId: retryOperationId } });
    const retried = await resolveDesktopConflict(retryConflict.id, { action: "RETRY" }, "chaos-test");
    assert.equal(retried.status, "queued");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chaos: restart during in-progress recovers operation and replays exactly once", serial, async () => {
  await resetState();
  const operationId = uniqueOperationId("op-restart-1");
  const row = await seedOperation(operationId);
  await updateLocalOperation(row.id, {
    status: "IN_PROGRESS",
    lastAttemptAt: new Date()
  });

  const recoveredCount = await recoverInProgressLocalOperations();
  assert.equal(recoveredCount, 1);
  const recovered = await prisma.localOperation.findUnique({ where: { operationId } });
  assert.ok(recovered);
  assert.equal(recovered.status, "RETRY_SCHEDULED");

  let seenCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    const body = JSON.parse(init.body);
    const found = body.changes.filter((change) => change.operationId === operationId);
    seenCount += found.length;
    return jsonResponse(200, {
      data: {
        results: body.changes.map((change) => ({ operationId: change.operationId, status: "APPLIED" })),
        conflicts: [],
        serverChanges: []
      },
      meta: { revision: 60 }
    });
  };

  try {
    await pushPendingChanges();
    const final = await prisma.localOperation.findUnique({ where: { operationId } });
    assert.equal(final.status, "SYNCED");
    assert.equal(seenCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
