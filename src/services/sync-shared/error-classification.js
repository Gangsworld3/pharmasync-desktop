export function computeCycleBackoffMs({
  currentRetryBackoffMs,
  syncIntervalMs,
  retryMaxMs,
  jitterMs
}) {
  return currentRetryBackoffMs
    ? Math.min(jitterMs(currentRetryBackoffMs * 2), retryMaxMs)
    : Math.min(jitterMs(syncIntervalMs * 2), retryMaxMs);
}
