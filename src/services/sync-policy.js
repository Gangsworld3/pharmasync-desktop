export const DEFAULT_SYNC_INTERVAL_MS = 15000;
export const DEFAULT_RETRY_BASE_MS = 2500;
export const DEFAULT_RETRY_MAX_MS = 300000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
export const DEFAULT_PUSH_BATCH_SIZE = 25;
export const DEFAULT_MAX_REQUEST_RETRIES = 3;
export const DEFAULT_MAX_OPERATION_ATTEMPTS = 8;
export const DEFAULT_REALTIME_RETRY_BASE_MS = 3000;
export const DEFAULT_REALTIME_RETRY_MAX_MS = 120000;
export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function getRemoteConfig(desktopSession) {
  const settings = desktopSession.getDesktopSettings();
  const syncIntervalMs = Number(settings.syncIntervalMs ?? process.env.PHARMASYNC_SYNC_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS);

  return {
    baseUrl: settings.backendUrl ?? process.env.PHARMASYNC_REMOTE_API_URL ?? "http://127.0.0.1:8090",
    email: process.env.PHARMASYNC_SYNC_EMAIL ?? null,
    password: process.env.PHARMASYNC_SYNC_PASSWORD ?? null,
    syncIntervalMs: Number.isFinite(syncIntervalMs) && syncIntervalMs > 0 ? syncIntervalMs : DEFAULT_SYNC_INTERVAL_MS,
    retryBaseMs: Number(process.env.PHARMASYNC_SYNC_RETRY_BASE_MS ?? DEFAULT_RETRY_BASE_MS),
    retryMaxMs: Number(process.env.PHARMASYNC_SYNC_RETRY_MAX_MS ?? DEFAULT_RETRY_MAX_MS),
    requestTimeoutMs: Number(process.env.PHARMASYNC_SYNC_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS),
    pushBatchSize: Number(process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE ?? DEFAULT_PUSH_BATCH_SIZE),
    maxRequestRetries: Number(process.env.PHARMASYNC_SYNC_REQUEST_RETRIES ?? DEFAULT_MAX_REQUEST_RETRIES),
    maxOperationAttempts: Number(process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS ?? DEFAULT_MAX_OPERATION_ATTEMPTS),
    realtimeRetryBaseMs: Number(process.env.PHARMASYNC_SYNC_REALTIME_RETRY_BASE_MS ?? DEFAULT_REALTIME_RETRY_BASE_MS),
    realtimeRetryMaxMs: Number(process.env.PHARMASYNC_SYNC_REALTIME_RETRY_MAX_MS ?? DEFAULT_REALTIME_RETRY_MAX_MS)
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterMs(baseMs) {
  const bounded = Math.max(250, baseMs);
  const spread = Math.floor(bounded * 0.3);
  const randomized = bounded + Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  return Math.max(250, randomized);
}

export function classifyErrorMessage(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("network")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("fetch failed")
    || message.includes("socket")
    || message.includes("econnrefused")
    || message.includes("econnreset")
    || message.includes("enotfound")
    || message.includes("temporarily unavailable");
}

export function parseJsonSafe(raw) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
