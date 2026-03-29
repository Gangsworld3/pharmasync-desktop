import {
  appendMessageFromServer,
  appendLocalOperation,
  ensureDeviceState,
  getConflictLocalOperations,
  getDeviceState,
  getPendingLocalOperations,
  recoverInProgressLocalOperations,
  updateDeviceState,
  updateLocalOperation,
  upsertAppointmentFromServer,
  upsertClientFromServer,
  upsertInventoryFromServer,
  upsertInvoiceFromServer
} from "../db/repositories.js";
import {
  appendDesktopLog,
  clearDesktopSession,
  getDesktopSession,
  getDesktopSettings,
  saveDesktopSession
} from "./desktop-runtime.js";
import {
  getDeferredState,
  sanitizePositiveNumber,
  shouldRetry
} from "./sync-retry-scheduler.js";
import { transition } from "./sync-state-machine.js";
import { mapConflict } from "./sync-conflict-adapter.js";
import { pushPendingChanges as pushPendingChangesPipeline } from "./sync-push-service.js";
import { pullServerChanges as pullServerChangesPipeline } from "./sync-pull-service.js";
import { runSyncCycle as runSyncCyclePipeline } from "./sync-cycle-runner.js";
import { startLoop, stopLoop } from "./sync-loop.js";

let syncTimer = null;
let syncInFlight = false;
let authToken = null;
let retryBackoffMs = 0;
let nextScheduledAt = null;
let realtimeSocket = null;
let realtimeReconnectTimer = null;
let realtimeReconnectMs = 0;
let realtimeEnabled = false;

const DEFAULT_SYNC_INTERVAL_MS = 15000;
const DEFAULT_RETRY_BASE_MS = 2500;
const DEFAULT_RETRY_MAX_MS = 300000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_PUSH_BATCH_SIZE = 25;
const DEFAULT_MAX_REQUEST_RETRIES = 3;
const DEFAULT_MAX_OPERATION_ATTEMPTS = 8;
const DEFAULT_REALTIME_RETRY_BASE_MS = 3000;
const DEFAULT_REALTIME_RETRY_MAX_MS = 120000;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function getRemoteConfig() {
  const settings = getDesktopSettings();
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(baseMs) {
  const bounded = Math.max(250, baseMs);
  const spread = Math.floor(bounded * 0.3);
  const randomized = bounded + Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  return Math.max(250, randomized);
}

function classifyErrorMessage(error) {
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

function parseJsonSafe(raw) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function applyOperationTransition(operation, event, context = {}) {
  const result = transition(operation, event, context);
  await updateLocalOperation(operation.id, result.patch);
  return result.nextState;
}

async function getAuthHeaders(forceRefresh = false) {
  const { baseUrl, email, password } = getRemoteConfig();
  const session = getDesktopSession();

  if (forceRefresh) {
    authToken = null;
  }

  if (!authToken && session?.accessToken && !forceRefresh) {
    authToken = session.accessToken;
  }

  if (!authToken && email && password) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error(`Remote authentication failed (${response.status}).`);
    }

    const payload = await response.json();
    authToken = payload.data.access_token;
    saveDesktopSession({
      accessToken: authToken,
      email,
      createdAt: new Date().toISOString()
    });
  }

  if (!authToken) {
    throw new Error("Remote authentication required. Sign in from desktop settings.");
  }

  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json"
  };
}

async function requestWithRetry(url, init, config) {
  const maxRequestRetries = sanitizePositiveNumber(config.maxRequestRetries, DEFAULT_MAX_REQUEST_RETRIES);
  const timeoutMs = sanitizePositiveNumber(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  let attempt = 0;
  let lastError = null;

  while (attempt < maxRequestRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRequestRetries) {
        await sleep(jitterMs((2 ** (attempt - 1)) * sanitizePositiveNumber(config.retryBaseMs, DEFAULT_RETRY_BASE_MS)));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      const retryable = error?.name === "AbortError" || classifyErrorMessage(error);
      if (!retryable || attempt >= maxRequestRetries) {
        throw error;
      }

      await sleep(jitterMs((2 ** (attempt - 1)) * sanitizePositiveNumber(config.retryBaseMs, DEFAULT_RETRY_BASE_MS)));
    }
  }

  throw lastError ?? new Error("Request failed.");
}

async function requestJson(path, init, config) {
  const response = await requestWithRetry(`${getRemoteConfig().baseUrl}${path}`, init, config);
  const raw = await response.text();
  const parsed = parseJsonSafe(raw);
  return { response, body: parsed };
}

async function authorizedJsonRequest(path, init) {
  const config = getRemoteConfig();
  let headers = await getAuthHeaders();
  let result = await requestJson(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, config);

  if (result.response.status === 401) {
    authToken = null;
    headers = await getAuthHeaders(true);
    result = await requestJson(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, config);
  }

  return result;
}

export async function authenticateDesktopSession(email, password) {
  const { baseUrl } = getRemoteConfig();
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    throw new Error(`Remote authentication failed (${response.status}).`);
  }

  const payload = await response.json();
  authToken = payload.data.access_token;
  saveDesktopSession({
    accessToken: authToken,
    email,
    createdAt: new Date().toISOString()
  });
  appendDesktopLog("sync.log", `auth success email=${email}`);
  return { email, authenticated: true };
}

export function logoutDesktopSession() {
  authToken = null;
  clearDesktopSession();
  appendDesktopLog("sync.log", "auth logout");
  return { authenticated: false };
}

function parsePayloadJson(raw) {
  return raw ? JSON.parse(raw) : null;
}

function buildWebSocketUrl(baseUrl, token) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/sync/ws";
  url.searchParams.set("token", token);
  return url.toString();
}

async function startRealtimeSyncListener() {
  if (typeof WebSocket === "undefined" || realtimeSocket) {
    return;
  }

  const session = getDesktopSession();
  if (!session?.accessToken) {
    return;
  }

  realtimeEnabled = true;
  const { baseUrl, realtimeRetryBaseMs, realtimeRetryMaxMs } = getRemoteConfig();
  const retryBase = sanitizePositiveNumber(realtimeRetryBaseMs, DEFAULT_REALTIME_RETRY_BASE_MS);
  const retryMax = sanitizePositiveNumber(realtimeRetryMaxMs, DEFAULT_REALTIME_RETRY_MAX_MS);

  const connect = () => {
    if (!realtimeEnabled) {
      return;
    }

    try {
      const wsUrl = buildWebSocketUrl(baseUrl, session.accessToken);
      realtimeSocket = new WebSocket(wsUrl);
    } catch (error) {
      appendDesktopLog("error.log", `sync realtime connect failure detail=${error.message}`);
      scheduleReconnect(retryBase, retryMax);
      return;
    }

    realtimeSocket.onopen = () => {
      realtimeReconnectMs = 0;
      appendDesktopLog("sync.log", "sync realtime connected");
    };

    realtimeSocket.onmessage = (event) => {
      try {
        const message = typeof event.data === "string" ? JSON.parse(event.data) : null;
        if (message?.type === "sync.revision") {
          void runSyncCycle();
        }
      } catch {
        // no-op: ignore malformed realtime payloads
      }
    };

    realtimeSocket.onclose = () => {
      realtimeSocket = null;
      if (!realtimeEnabled) {
        return;
      }
      scheduleReconnect(retryBase, retryMax);
    };

    realtimeSocket.onerror = () => {
      // close handler will schedule reconnect
    };
  };

  const scheduleReconnect = (base, max) => {
    if (realtimeReconnectTimer || !realtimeEnabled) {
      return;
    }
    realtimeReconnectMs = realtimeReconnectMs
      ? Math.min(jitterMs(realtimeReconnectMs * 2), max)
      : base;
    realtimeReconnectTimer = setTimeout(() => {
      realtimeReconnectTimer = null;
      connect();
    }, realtimeReconnectMs);
  };

  connect();
}

function stopRealtimeSyncListener() {
  realtimeEnabled = false;
  if (realtimeReconnectTimer) {
    clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = null;
  }
  if (realtimeSocket) {
    realtimeSocket.close();
    realtimeSocket = null;
  }
}

function sortServerChanges(changes) {
  return [...changes].sort((left, right) => (left.serverRevision ?? 0) - (right.serverRevision ?? 0));
}

function buildSyncChange(operationRow) {
  return {
    operationId: operationRow.operationId,
    idempotencyKey: operationRow.idempotencyKey ?? operationRow.operationId,
    entity: operationRow.entityType,
    operation: operationRow.operation,
    entityId: operationRow.entityId,
    localRevision: operationRow.localRevision,
    data: parsePayloadJson(operationRow.payloadJson)
  };
}

function buildSyncResultSummary(results = []) {
  const summary = {
    applied: 0,
    idempotentReplay: 0,
    conflict: 0,
    rejected: 0
  };

  for (const result of results) {
    if (result.status === "APPLIED") {
      summary.applied += 1;
    } else if (result.status === "IDEMPOTENT_REPLAY") {
      summary.idempotentReplay += 1;
    } else if (result.status === "CONFLICT") {
      summary.conflict += 1;
    } else {
      summary.rejected += 1;
    }
  }

  return summary;
}

async function markSyncStart(deviceState) {
  appendDesktopLog("sync.log", `sync start device=${deviceState.deviceId}`);
  return updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "SYNCING",
    lastSyncStartedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl: getRemoteConfig().baseUrl
  });
}

async function markSyncFinish(deviceState, revision) {
  appendDesktopLog("sync.log", `sync success device=${deviceState.deviceId} revision=${revision}`);
  return updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "SYNCED",
    lastPulledRevision: revision,
    lastSyncCompletedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl: getRemoteConfig().baseUrl
  });
}

async function markSyncFailure(deviceState, error) {
  appendDesktopLog("error.log", `sync failure device=${deviceState.deviceId} detail=${error.message}`);
  return updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "ERROR",
    lastSyncError: error.message,
    lastSyncCompletedAt: new Date(),
    remoteBaseUrl: getRemoteConfig().baseUrl
  });
}

export async function recordLocalOperation(entry) {
  return appendLocalOperation(entry);
}

function buildPushContext() {
  return {
    ensureDeviceState,
    getRemoteConfig,
    getPendingLocalOperations,
    shouldRetry,
    getDeferredState,
    sanitizePositiveNumber,
    defaultPushBatchSize: DEFAULT_PUSH_BATCH_SIZE,
    buildSyncChange,
    authorizedJsonRequest,
    applyOperationTransition,
    mapConflict,
    applyServerChange,
    sortServerChanges,
    defaultMaxOperationAttempts: DEFAULT_MAX_OPERATION_ATTEMPTS
  };
}

export async function pushPendingChanges() {
  const result = await pushPendingChangesPipeline(buildPushContext());
  return {
    ...result,
    resultSummary: buildSyncResultSummary(result.results ?? [])
  };
}

async function applyServerChange(change) {
  switch (change.entity) {
    case "Client":
      return upsertClientFromServer(change);
    case "InventoryItem":
      return upsertInventoryFromServer(change);
    case "Appointment":
      return upsertAppointmentFromServer(change);
    case "Invoice":
      return upsertInvoiceFromServer(change);
    case "Message":
      return appendMessageFromServer(change);
    default:
      return null;
  }
}

function buildPullContext() {
  return {
    ensureDeviceState,
    authorizedJsonRequest,
    sortServerChanges,
    applyServerChange,
    updateDeviceState,
    getRemoteConfig
  };
}

export async function pullServerChanges() {
  return pullServerChangesPipeline(buildPullContext());
}

function buildCycleContext() {
  return {
    getSyncInFlight: () => syncInFlight,
    setSyncInFlight: (value) => { syncInFlight = value; },
    ensureDeviceState,
    recoverInProgressLocalOperations,
    markSyncStart,
    pushPendingChanges,
    pullServerChanges,
    markSyncFinish,
    getConflictLocalOperations,
    clearAuthToken: () => { authToken = null; },
    getRemoteConfig,
    sanitizePositiveNumber,
    defaultRetryMaxMs: DEFAULT_RETRY_MAX_MS,
    jitterMs,
    getRetryBackoffMs: () => retryBackoffMs,
    setRetryBackoffMs: (value) => { retryBackoffMs = value; },
    setNextScheduledAt: (value) => { nextScheduledAt = value; },
    markSyncFailure
  };
}

export async function runSyncCycle() {
  return runSyncCyclePipeline(buildCycleContext());
}

export async function getSyncEngineStatus() {
  const deviceState = await ensureDeviceState();
  const [pendingOperations, conflictOperations] = await Promise.all([
    getPendingLocalOperations(),
    getConflictLocalOperations()
  ]);
  const session = getDesktopSession();

  return {
    deviceId: deviceState.deviceId,
    lastPulledRevision: deviceState.lastPulledRevision,
    syncStatus: deviceState.syncStatus,
    lastSyncStartedAt: deviceState.lastSyncStartedAt,
    lastSyncCompletedAt: deviceState.lastSyncCompletedAt,
    lastSyncError: deviceState.lastSyncError,
    pendingOperations: pendingOperations.length,
    conflicts: conflictOperations.length,
    remoteBaseUrl: deviceState.remoteBaseUrl ?? getRemoteConfig().baseUrl,
    authenticated: Boolean(session?.accessToken),
    sessionEmail: session?.email ?? null,
    retryBackoffMs,
    nextScheduledAt: nextScheduledAt?.toISOString() ?? null
  };
}

function buildLoopContext() {
  return {
    ensureDeviceState,
    getSyncTimer: () => syncTimer,
    setSyncTimer: (value) => { syncTimer = value; },
    startRealtimeSyncListener,
    runSyncCycle,
    getRetryBackoffMs: () => retryBackoffMs,
    setNextScheduledAt: (value) => { nextScheduledAt = value; },
    getRemoteConfig,
    stopRealtimeSyncListener
  };
}

export async function startBackgroundSyncLoop(intervalMs = null) {
  return startLoop(buildLoopContext(), intervalMs);
}

export function stopBackgroundSyncLoop() {
  return stopLoop(buildLoopContext());
}
