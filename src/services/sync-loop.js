export async function startLoop({ repo, state, realtime, cycle, config, clock }, intervalMs = null) {
  await repo.ensureDeviceState();
  const { getSyncTimer, setSyncTimer, getRetryBackoffMs, setNextScheduledAt } = state;
  if (getSyncTimer()) {
    return;
  }

  await realtime.start();

  const schedule = async () => {
    await cycle.runSyncCycle().catch(() => {});
    const nextDelay = getRetryBackoffMs() || Number(intervalMs ?? config.get().syncIntervalMs);
    setNextScheduledAt(new Date(clock.nowMs() + nextDelay));
    setSyncTimer(clock.setTimeout(schedule, nextDelay));
  };

  const initialDelay = Number(intervalMs ?? config.get().syncIntervalMs);
  setNextScheduledAt(new Date(clock.nowMs() + initialDelay));
  setSyncTimer(clock.setTimeout(schedule, initialDelay));
}

export function stopLoop({ state, realtime, clock }) {
  const { getSyncTimer, setSyncTimer, setNextScheduledAt } = state;
  const timer = getSyncTimer();
  if (timer) {
    clock.clearTimeout(timer);
    setSyncTimer(null);
  }
  realtime.stop();
  setNextScheduledAt(null);
}
