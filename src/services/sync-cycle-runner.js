import { computeCycleBackoffMs } from "./sync-shared/error-classification.js";

export async function runSyncCycle({ state, repo, cycle, auth, config, clock, policy, lifecycle }) {
  const {
    getSyncInFlight,
    setSyncInFlight,
    getRetryBackoffMs,
    setRetryBackoffMs,
    setNextScheduledAt
  } = state;

  if (getSyncInFlight()) {
    return { status: "skipped", reason: "sync_in_progress" };
  }

  setSyncInFlight(true);
  const deviceState = await repo.ensureDeviceState();

  try {
    await repo.recoverInProgressOperations();
    await lifecycle.markSyncStart(deviceState);
    const pushResult = await cycle.pushPendingChanges();
    const pullResult = await cycle.pullServerChanges();
    const latestRevision = Math.max(pushResult.revision ?? 0, pullResult.revision ?? 0);
    await lifecycle.markSyncFinish(deviceState, latestRevision);
    setRetryBackoffMs(0);
    setNextScheduledAt(null);

    return {
      status: "success",
      push: pushResult,
      pull: pullResult,
      conflicts: await repo.listConflictOperations(),
      retryBackoffMs: getRetryBackoffMs(),
      nextScheduledAt: null
    };
  } catch (error) {
    auth.clear();
    const runtimeConfig = config.get();
    const retryMax = policy.sanitizePositiveNumber(runtimeConfig.retryMaxMs, policy.defaultRetryMaxMs);
    const currentRetryBackoff = getRetryBackoffMs();
    const nextBackoff = computeCycleBackoffMs({
      currentRetryBackoffMs: currentRetryBackoff,
      syncIntervalMs: runtimeConfig.syncIntervalMs,
      retryMaxMs: retryMax,
      jitterMs: policy.jitterMs
    });
    const nextRetryAt = new Date(clock.nowMs() + nextBackoff);
    setRetryBackoffMs(nextBackoff);
    setNextScheduledAt(nextRetryAt);
    await lifecycle.markSyncFailure(deviceState, error);
    return {
      status: "error",
      error: error.message,
      retryBackoffMs: nextBackoff,
      nextRetryAt: nextRetryAt.toISOString()
    };
  } finally {
    setSyncInFlight(false);
  }
}
