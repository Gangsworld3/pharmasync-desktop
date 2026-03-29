const DEFAULT_RETRY_BASE_MS = 2500;
const DEFAULT_RETRY_MAX_MS = 300000;

export function sanitizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function computeNextRetry(operation, config) {
  const retryBase = sanitizePositiveNumber(config.retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const retryMax = sanitizePositiveNumber(config.retryMaxMs, DEFAULT_RETRY_MAX_MS);
  if (!operation.backoffMs || operation.backoffMs <= 0) {
    return retryBase;
  }
  return Math.min(operation.backoffMs * 2, retryMax);
}

export function shouldRetry(operation, now, config) {
  if (operation.status === "PENDING") {
    return true;
  }

  if (operation.nextAttemptAt) {
    return new Date(operation.nextAttemptAt).getTime() <= now.getTime();
  }

  if (!operation.lastAttemptAt) {
    return true;
  }

  const fallbackCooldownMs = computeNextRetry(operation, config);
  return now.getTime() - new Date(operation.lastAttemptAt).getTime() >= fallbackCooldownMs;
}

export function getDeferredState(operation, now, config) {
  const nextAttemptAt = operation.nextAttemptAt
    ? new Date(operation.nextAttemptAt)
    : (operation.lastAttemptAt
      ? new Date(new Date(operation.lastAttemptAt).getTime() + computeNextRetry(operation, config))
      : null);
  const remainingMs = nextAttemptAt ? Math.max(0, nextAttemptAt.getTime() - now.getTime()) : 0;

  return {
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey ?? null,
    status: operation.status,
    attempts: operation.attempts ?? 0,
    backoffMs: operation.backoffMs ?? 0,
    lastAttemptAt: operation.lastAttemptAt ?? null,
    nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
    remainingMs
  };
}
