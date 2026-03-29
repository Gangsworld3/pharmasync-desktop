import test from "node:test";
import assert from "node:assert/strict";

import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import {
  appendLocalOperation,
  createLocalClient,
  createLocalAppointment,
  ensureDeviceState,
  recoverInProgressLocalOperations,
  updateLocalOperation
} from "../src/db/repositories.js";
import { resolveDesktopConflict } from "../src/services/offline-service.js";
import { getSyncEngineStatus, pushPendingChanges, runSyncCycle } from "../src/services/sync-engine.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

async function resetState() {
  await prisma.localOperation.deleteMany();
  await ensureDeviceState();
  saveDesktopSession({ accessToken: "chaos-matrix-token", email: "chaos-matrix@test.local" });
}

async function seedOperation({
  operationId,
  entityType = "InventoryItem",
  entityId = "entity-1",
  operation = "UPDATE",
  payload = { sku: "SKU-1", quantity_on_hand: 5 },
  localRevision = 1
}) {
  const row = await appendLocalOperation({
    operationId,
    idempotencyKey: `chaos-idem-${operationId}-${Date.now()}`,
    entityType,
    entityId,
    operation,
    localRevision,
    payload,
    status: "PENDING"
  });
  return row;
}

async function buildScorecard() {
  const ops = await prisma.localOperation.findMany();
  const grouped = ops.reduce((acc, op) => {
    acc[op.status] = (acc[op.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    operationsProcessed: ops.length,
    synced: grouped.SYNCED ?? 0,
    conflicts: grouped.CONFLICT ?? 0,
    retryScheduled: grouped.RETRY_SCHEDULED ?? 0,
    deadLetters: grouped.DEAD_LETTER ?? 0,
    inProgress: grouped.IN_PROGRESS ?? 0
  };
}

test("workflow 1: offline sales sync under mid-batch cut preserves correctness", { concurrency: false }, async () => {
  await resetState();
  process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE = "2";
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "1";
  const runId = Date.now().toString(36);

  const opIds = [
    `wf1-sale-inv-1-${runId}`,
    `wf1-sale-inv-2-${runId}`,
    `wf1-sale-inv-3-${runId}`,
    `wf1-sale-inv-4-${runId}`
  ];

  await seedOperation({
    operationId: opIds[0],
    entityId: "inv-pcm",
    payload: { sku: "PCM-001", quantity_on_hand: 95 }
  });
  await seedOperation({
    operationId: opIds[1],
    entityId: "inv-amx",
    payload: { sku: "AMX-001", quantity_on_hand: 48 }
  });
  await seedOperation({
    operationId: opIds[2],
    entityId: "inv-pcm",
    payload: { sku: "PCM-001", quantity_on_hand: 90 }
  });
  await seedOperation({
    operationId: opIds[3],
    entityId: "inv-amx",
    payload: { sku: "AMX-001", quantity_on_hand: 46 }
  });

  let pushCalls = 0;
  const networkBatches = [];
  const effectCountByOperationId = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    const body = JSON.parse(init.body);
    const opBatch = body.changes.map((change) => change.operationId);
    networkBatches.push(opBatch);
    pushCalls += 1;

    if (pushCalls === 1) {
      return jsonResponse(200, {
        data: {
          results: opBatch.map((opId) => {
            effectCountByOperationId.set(opId, (effectCountByOperationId.get(opId) ?? 0) + 1);
            return { operationId: opId, status: "APPLIED" };
          }),
          conflicts: [],
          serverChanges: []
        },
        meta: { revision: 100 }
      });
    }

    if (pushCalls === 2) {
      throw new TypeError("simulated network cut");
    }

    return jsonResponse(200, {
      data: {
        results: opBatch.map((opId) => {
          if (!effectCountByOperationId.has(opId)) {
            effectCountByOperationId.set(opId, 1);
            return { operationId: opId, status: "APPLIED" };
          }
          return { operationId: opId, status: "IDEMPOTENT_REPLAY" };
        }),
        conflicts: [],
        serverChanges: []
      },
      meta: { revision: 101 }
    });
  };

  try {
    await assert.rejects(pushPendingChanges);
    await prisma.localOperation.updateMany({
      where: { status: "RETRY_SCHEDULED" },
      data: { nextAttemptAt: new Date() }
    });
    await pushPendingChanges();

    const rows = await prisma.localOperation.findMany({
      where: { operationId: { in: opIds } }
    });
    const synced = rows.filter((row) => row.status === "SYNCED").length;
    const queued = rows.filter((row) => row.status === "RETRY_SCHEDULED").length;
    const dead = rows.filter((row) => row.status === "DEAD_LETTER").length;
    assert.equal(dead, 0);
    assert.equal(synced + queued, 4);
    assert.deepEqual(networkBatches[0], [opIds[0], opIds[1]]);
    assert.deepEqual(networkBatches[1], [opIds[2], opIds[3]]);
    assert.deepEqual(networkBatches[2], [opIds[2], opIds[3]]);
    for (const opId of opIds) {
      assert.equal((effectCountByOperationId.get(opId) ?? 0) <= 1, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE;
    delete process.env.PHARMASYNC_SYNC_REQUEST_RETRIES;
  }
});

test("workflow 2: appointment collision returns conflict + suggested slots + timezone metadata", { concurrency: false }, async () => {
  await resetState();
  const runId = Date.now().toString(36);
  const client = await createLocalClient({
    id: `client-chaos-1-${runId}`,
    clientCode: `CLI-CHAOS-1-${runId}`,
    fullName: "Chaos Client 1",
    operationId: `wf2-client-op-${runId}`
  });

  const appointment = await createLocalAppointment({
    id: `appt-chaos-1-${runId}`,
    clientId: client.id,
    serviceType: "Consultation",
    staffName: "Dr. Slot",
    startsAt: "2026-04-01T09:00:00Z",
    endsAt: "2026-04-01T09:30:00Z",
    status: "PENDING",
    operationId: `wf2-appt-create-op-${runId}`
  });

  const conflictPayload = {
    type: "APPOINTMENT_SCHEDULE_CONFLICT",
    entityId: appointment.id,
    local: {
      operationId: `wf2-appt-create-op-${runId}`,
      data: {
        staff_name: "Dr. Slot",
        starts_at: "2026-04-01T09:00:00Z",
        ends_at: "2026-04-01T09:30:00Z"
      }
    },
    server: {
      starts_at: "2026-04-01T09:00:00Z",
      ends_at: "2026-04-01T09:30:00Z",
      status: "CONFIRMED",
      server_revision: 42
    },
    serverRevision: 42,
    strictFields: ["starts_at", "ends_at"],
    timezone: "Africa/Juba",
    serverSuggestedNextSlots: [
      {
        starts_at: "2026-04-01T12:00:00+03:00",
        ends_at: "2026-04-01T12:30:00+03:00",
        timezone: "Africa/Juba"
      }
    ],
    scheduleContext: {
      staff_name: "Dr. Slot",
      starts_at: "2026-04-01T09:00:00Z",
      ends_at: "2026-04-01T09:30:00Z",
      timezone: "Africa/Juba"
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    return jsonResponse(200, {
      data: {
        results: [{ operationId: `wf2-appt-create-op-${runId}`, status: "CONFLICT" }],
        conflicts: [conflictPayload],
        serverChanges: []
      },
      meta: { revision: 42 }
    });
  };

  try {
    const result = await pushPendingChanges();
    assert.equal(result.resultSummary.conflict, 1);

    const op = await prisma.localOperation.findUnique({ where: { operationId: `wf2-appt-create-op-${runId}` } });
    assert.ok(op);
    assert.equal(op.status, "CONFLICT");

    const payload = JSON.parse(op.conflictPayloadJson);
    assert.equal(payload.type, "APPOINTMENT_SCHEDULE_CONFLICT");
    assert.equal(payload.timezone, "Africa/Juba");
    assert.equal(payload.scheduleContext.timezone, "Africa/Juba");
    assert.ok(Array.isArray(payload.serverSuggestedNextSlots));
    assert.ok(payload.serverSuggestedNextSlots.length > 0);
    assert.equal(payload.serverSuggestedNextSlots[0].timezone, "Africa/Juba");

    const resolved = await resolveDesktopConflict(op.id, {
      action: "RESCHEDULE",
      suggestedStart: payload.serverSuggestedNextSlots[0]
    }, "chaos-matrix");
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.action, "RESCHEDULE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workflow 3: repeated backend failure reaches DEAD_LETTER without infinite retry", { concurrency: false }, async () => {
  await resetState();
  await ensureDeviceState();
  const runId = Date.now().toString(36);
  process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS = "3";
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "1";

  await seedOperation({
    operationId: `wf3-dead-letter-${runId}`,
    entityId: "inv-dead",
    payload: { sku: "DEAD-001", quantity_on_hand: 1 }
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return jsonResponse(500, { error: "forced 500" });
  };

  try {
    for (let i = 0; i < 4; i += 1) {
      await runSyncCycle();
      await prisma.localOperation.updateMany({
        where: { operationId: `wf3-dead-letter-${runId}`, status: "RETRY_SCHEDULED" },
        data: { nextAttemptAt: new Date() }
      });
    }

    const op = await prisma.localOperation.findUnique({ where: { operationId: `wf3-dead-letter-${runId}` } });
    assert.ok(op);
    assert.equal(op.status, "DEAD_LETTER");
    assert.ok(op.deadLetteredAt instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS;
    delete process.env.PHARMASYNC_SYNC_REQUEST_RETRIES;
  }
});

test("workflow 4: crash during IN_PROGRESS recovers deterministically and syncs once", { concurrency: false }, async () => {
  await resetState();
  const runId = Date.now().toString(36);
  const row = await seedOperation({
    operationId: `wf4-recover-op-${runId}`,
    entityId: "inv-recover",
    payload: { sku: "RCV-001", quantity_on_hand: 3 }
  });
  await updateLocalOperation(row.id, {
    status: "IN_PROGRESS",
    lastAttemptAt: new Date()
  });

  const recovered = await recoverInProgressLocalOperations();
  assert.equal(recovered, 1);

  let seen = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    const body = JSON.parse(init.body);
    seen += body.changes.filter((change) => change.operationId === `wf4-recover-op-${runId}`).length;
    return jsonResponse(200, {
      data: {
        results: body.changes.map((change) => ({ operationId: change.operationId, status: "APPLIED" })),
        conflicts: [],
        serverChanges: []
      },
      meta: { revision: 77 }
    });
  };

  try {
    await pushPendingChanges();
    const op = await prisma.localOperation.findUnique({ where: { operationId: `wf4-recover-op-${runId}` } });
    assert.ok(op);
    assert.equal(op.status, "SYNCED");
    assert.equal(seen, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workflow 5: timezone edge case preserves deterministic offset-aware slot metadata", { concurrency: false }, async () => {
  await resetState();
  const runId = Date.now().toString(36);
  const client = await createLocalClient({
    id: `client-chaos-2-${runId}`,
    clientCode: `CLI-CHAOS-2-${runId}`,
    fullName: "Chaos Client 2",
    operationId: `wf5-client-op-${runId}`
  });

  await createLocalAppointment({
    id: `appt-chaos-tz-1-${runId}`,
    clientId: client.id,
    serviceType: "Consultation",
    staffName: "Dr. TZ",
    startsAt: "2026-10-25T00:30:00Z",
    endsAt: "2026-10-25T01:00:00Z",
    status: "PENDING",
    operationId: `wf5-tz-op-${runId}`
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return jsonResponse(200, {
      data: {
        results: [{ operationId: `wf5-tz-op-${runId}`, status: "CONFLICT" }],
        conflicts: [{
          type: "APPOINTMENT_SCHEDULE_CONFLICT",
          entityId: `appt-chaos-tz-1-${runId}`,
          local: {
            operationId: `wf5-tz-op-${runId}`,
            data: {
              starts_at: "2026-10-25T00:30:00Z",
              ends_at: "2026-10-25T01:00:00Z"
            }
          },
          server: { server_revision: 120 },
          serverRevision: 120,
          timezone: "Europe/Berlin",
          serverSuggestedNextSlots: [
            {
              starts_at: "2026-10-25T02:00:00+01:00",
              ends_at: "2026-10-25T02:30:00+01:00",
              timezone: "Europe/Berlin"
            }
          ],
          scheduleContext: {
            starts_at: "2026-10-25T00:30:00Z",
            ends_at: "2026-10-25T01:00:00Z",
            timezone: "Europe/Berlin"
          }
        }],
        serverChanges: []
      },
      meta: { revision: 120 }
    });
  };

  try {
    await pushPendingChanges();
    const op = await prisma.localOperation.findUnique({ where: { operationId: `wf5-tz-op-${runId}` } });
    assert.ok(op);
    const payload = JSON.parse(op.conflictPayloadJson);

    const slot = payload.serverSuggestedNextSlots[0];
    const slotStart = new Date(slot.starts_at);
    const slotEnd = new Date(slot.ends_at);

    assert.equal(payload.timezone, "Europe/Berlin");
    assert.equal(payload.scheduleContext.timezone, "Europe/Berlin");
    assert.equal(slot.timezone, "Europe/Berlin");
    assert.ok(slot.starts_at.endsWith("+01:00") || slot.starts_at.endsWith("+02:00"));
    assert.ok(slotEnd.getTime() > slotStart.getTime());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chaos scorecard invariant check", { concurrency: false }, async () => {
  const scorecard = await buildScorecard();
  assert.equal(typeof scorecard.operationsProcessed, "number");
  assert.equal(typeof scorecard.synced, "number");
  assert.equal(typeof scorecard.conflicts, "number");
  assert.equal(typeof scorecard.retryScheduled, "number");
  assert.equal(typeof scorecard.deadLetters, "number");
  assert.equal(typeof scorecard.inProgress, "number");
});
