export async function startLoop(context, intervalMs = null) {
  const {
    ensureDeviceState,
    getSyncTimer,
    setSyncTimer,
    startRealtimeSyncListener,
    runSyncCycle,
    getRetryBackoffMs,
    setNextScheduledAt,
    getRemoteConfig
  } = context;

  await ensureDeviceState();
  if (getSyncTimer()) {
    return;
  }

  await startRealtimeSyncListener();

  const schedule = async () => {
    await runSyncCycle().catch(() => {});
    const nextDelay = getRetryBackoffMs() || Number(intervalMs ?? getRemoteConfig().syncIntervalMs);
    setNextScheduledAt(new Date(Date.now() + nextDelay));
    setSyncTimer(setTimeout(schedule, nextDelay));
  };

  const initialDelay = Number(intervalMs ?? getRemoteConfig().syncIntervalMs);
  setNextScheduledAt(new Date(Date.now() + initialDelay));
  setSyncTimer(setTimeout(schedule, initialDelay));
}

export function stopLoop(context) {
  const {
    getSyncTimer,
    setSyncTimer,
    stopRealtimeSyncListener,
    setNextScheduledAt
  } = context;

  const timer = getSyncTimer();
  if (timer) {
    clearTimeout(timer);
    setSyncTimer(null);
  }
  stopRealtimeSyncListener();
  setNextScheduledAt(null);
}
