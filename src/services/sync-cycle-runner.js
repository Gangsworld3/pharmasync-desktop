export async function runSyncCycle(context) {
  const {
    getSyncInFlight,
    setSyncInFlight,
    ensureDeviceState,
    recoverInProgressLocalOperations,
    markSyncStart,
    pushPendingChanges,
    pullServerChanges,
    markSyncFinish,
    getConflictLocalOperations,
    clearAuthToken,
    getRemoteConfig,
    sanitizePositiveNumber,
    defaultRetryMaxMs,
    jitterMs,
    getRetryBackoffMs,
    setRetryBackoffMs,
    setNextScheduledAt,
    markSyncFailure
  } = context;

  if (getSyncInFlight()) {
    return { status: "skipped", reason: "sync_in_progress" };
  }

  setSyncInFlight(true);
  const deviceState = await ensureDeviceState();

  try {
    await recoverInProgressLocalOperations();
    await markSyncStart(deviceState);
    const pushResult = await pushPendingChanges();
    const pullResult = await pullServerChanges();
    const latestRevision = Math.max(pushResult.revision ?? 0, pullResult.revision ?? 0);
    await markSyncFinish(deviceState, latestRevision);
    setRetryBackoffMs(0);
    setNextScheduledAt(null);

    return {
      status: "success",
      push: pushResult,
      pull: pullResult,
      conflicts: await getConflictLocalOperations(),
      retryBackoffMs: getRetryBackoffMs(),
      nextScheduledAt: null
    };
  } catch (error) {
    clearAuthToken();
    const { syncIntervalMs, retryMaxMs } = getRemoteConfig();
    const retryMax = sanitizePositiveNumber(retryMaxMs, defaultRetryMaxMs);
    const currentRetryBackoff = getRetryBackoffMs();
    const nextBackoff = currentRetryBackoff
      ? Math.min(jitterMs(currentRetryBackoff * 2), retryMax)
      : Math.min(jitterMs(syncIntervalMs * 2), retryMax);
    const nextRetryAt = new Date(Date.now() + nextBackoff);
    setRetryBackoffMs(nextBackoff);
    setNextScheduledAt(nextRetryAt);
    await markSyncFailure(deviceState, error);
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
