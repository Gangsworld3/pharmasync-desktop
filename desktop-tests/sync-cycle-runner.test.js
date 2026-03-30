import test from "node:test";
import assert from "node:assert/strict";

import { runSyncCycle } from "../src/services/sync-cycle-runner.js";

function createBaseContext() {
  const state = {
    syncInFlight: false,
    retryBackoffMs: 0,
    nextScheduledAt: null
  };

  const calls = {
    recover: 0,
    markStart: 0,
    markFinish: 0,
    markFailure: 0,
    push: 0,
    pull: 0,
    clearAuth: 0
  };

  return {
    calls,
    context: {
      state: {
        getSyncInFlight: () => state.syncInFlight,
        setSyncInFlight: (value) => { state.syncInFlight = value; },
        getRetryBackoffMs: () => state.retryBackoffMs,
        setRetryBackoffMs: (value) => { state.retryBackoffMs = value; },
        setNextScheduledAt: (value) => { state.nextScheduledAt = value; }
      },
      repo: {
        ensureDeviceState: async () => ({ deviceId: "device-1" }),
        recoverInProgressOperations: async () => { calls.recover += 1; },
        listConflictOperations: async () => []
      },
      cycle: {
        pushPendingChanges: async () => { calls.push += 1; return { revision: 4 }; },
        pullServerChanges: async () => { calls.pull += 1; return { revision: 5 }; }
      },
      auth: {
        clear: () => { calls.clearAuth += 1; }
      },
      config: {
        get: () => ({ syncIntervalMs: 1000, retryMaxMs: 120000 })
      },
      clock: {
        nowMs: () => 1_700_000_000_000
      },
      policy: {
        sanitizePositiveNumber: (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback),
        defaultRetryMaxMs: 120000,
        jitterMs: (value) => value
      },
      lifecycle: {
        markSyncStart: async () => { calls.markStart += 1; },
        markSyncFinish: async () => { calls.markFinish += 1; },
        markSyncFailure: async () => { calls.markFailure += 1; }
      }
    }
  };
}

test("sync cycle returns skipped when already in flight", async () => {
  const { context } = createBaseContext();
  context.state.getSyncInFlight = () => true;

  const result = await runSyncCycle(context);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "sync_in_progress");
});

test("sync cycle success path sequences recover -> push -> pull", async () => {
  const { calls, context } = createBaseContext();

  const result = await runSyncCycle(context);
  assert.equal(result.status, "success");
  assert.equal(calls.recover, 1);
  assert.equal(calls.push, 1);
  assert.equal(calls.pull, 1);
  assert.equal(calls.markStart, 1);
  assert.equal(calls.markFinish, 1);
  assert.equal(calls.markFailure, 0);
  assert.equal(calls.clearAuth, 0);
});

test("sync cycle error path computes retry and marks failure", async () => {
  const { calls, context } = createBaseContext();
  context.cycle.pushPendingChanges = async () => {
    calls.push += 1;
    throw new Error("network timeout");
  };

  const result = await runSyncCycle(context);
  assert.equal(result.status, "error");
  assert.equal(calls.recover, 1);
  assert.equal(calls.push, 1);
  assert.equal(calls.pull, 0);
  assert.equal(calls.markFailure, 1);
  assert.equal(calls.clearAuth, 1);
  assert.ok(result.retryBackoffMs > 0);
  assert.ok(typeof result.nextRetryAt === "string");
});
