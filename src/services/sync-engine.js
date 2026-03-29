import {
  appendMessageFromServer,
  appendLocalOperation,
  ensureDeviceState,
  getConflictLocalOperations,
  getDeviceState,
  getPendingLocalOperations,
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

let syncTimer = null;
let syncInFlight = false;
let authToken = null;
let retryBackoffMs = 0;

function getRemoteConfig() {
  const settings = getDesktopSettings();
  return {
    baseUrl: settings.backendUrl ?? process.env.PHARMASYNC_REMOTE_API_URL ?? "http://127.0.0.1:8090",
    email: process.env.PHARMASYNC_SYNC_EMAIL ?? null,
    password: process.env.PHARMASYNC_SYNC_PASSWORD ?? null,
    syncIntervalMs: Number(settings.syncIntervalMs ?? process.env.PHARMASYNC_SYNC_INTERVAL_MS ?? 15000)
  };
}

async function getAuthHeaders() {
  const { baseUrl, email, password } = getRemoteConfig();
  const session = getDesktopSession();

  if (!authToken && session?.accessToken) {
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

function sortServerChanges(changes) {
  return [...changes].sort((left, right) => (left.serverRevision ?? 0) - (right.serverRevision ?? 0));
}

function buildSyncChange(operationRow) {
  return {
    operationId: operationRow.operationId,
    entity: operationRow.entityType,
    operation: operationRow.operation,
    entityId: operationRow.entityId,
    localRevision: operationRow.localRevision,
    data: parsePayloadJson(operationRow.payloadJson)
  };
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

export async function pushPendingChanges() {
  const deviceState = await ensureDeviceState();
  const pendingOperations = await getPendingLocalOperations();

  if (!pendingOperations.length) {
    return { pushed: 0, revision: deviceState.lastPulledRevision, results: [] };
  }

  const headers = await getAuthHeaders();
  const payload = {
    deviceId: deviceState.deviceId,
    lastPulledRevision: deviceState.lastPulledRevision,
    changes: pendingOperations.map(buildSyncChange)
  };

  const response = await fetch(`${getRemoteConfig().baseUrl}/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Push failed (${response.status}).`);
  }

  const body = await response.json();
  const results = body.data.results;
  const serverChanges = sortServerChanges(body.data.serverChanges ?? []);

  for (const operation of pendingOperations) {
    const result = results.find((entry) => entry.operationId === operation.operationId);
    if (!result) {
      continue;
    }

    if (result.status === "APPLIED" || result.status === "IDEMPOTENT_REPLAY") {
      await updateLocalOperation(operation.id, {
        status: "SYNCED",
        errorDetail: null,
        conflictPayloadJson: null,
        attempts: { increment: 1 },
        lastAttemptAt: new Date()
      });
      continue;
    }

    if (result.status === "CONFLICT") {
      const conflict = body.data.conflicts.find((entry) => entry.entityId === operation.entityId && entry.local.operationId === operation.operationId);
      await updateLocalOperation(operation.id, {
        status: "CONFLICT",
        conflictPayloadJson: conflict,
        errorDetail: null,
        attempts: { increment: 1 },
        lastAttemptAt: new Date()
      });
      continue;
    }

    await updateLocalOperation(operation.id, {
      status: "RETRY",
      errorDetail: result.error ?? "Remote rejection",
      attempts: { increment: 1 },
      lastAttemptAt: new Date()
    });
  }

  for (const change of serverChanges) {
    await applyServerChange(change);
  }

  return {
    pushed: pendingOperations.length,
    revision: body.meta.revision,
    serverChanges,
    results
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

export async function pullServerChanges() {
  const deviceState = await ensureDeviceState();
  const headers = await getAuthHeaders();
  const response = await fetch(`${getRemoteConfig().baseUrl}/sync/pull?since=${deviceState.lastPulledRevision}`, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    throw new Error(`Pull failed (${response.status}).`);
  }

  const body = await response.json();
  const serverChanges = sortServerChanges(body.data.serverChanges ?? []);

  for (const change of serverChanges) {
    await applyServerChange(change);
  }

  await updateDeviceState({
    deviceId: deviceState.deviceId,
    lastPulledRevision: body.meta.revision,
    syncStatus: "SYNCED",
    lastSyncCompletedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl: getRemoteConfig().baseUrl
  });

  return {
    pulled: serverChanges.length,
    revision: body.meta.revision,
    serverChanges
  };
}

export async function runSyncCycle() {
  if (syncInFlight) {
    return { status: "skipped", reason: "sync_in_progress" };
  }

  syncInFlight = true;
  const deviceState = await ensureDeviceState();

  try {
    await markSyncStart(deviceState);
    const pushResult = await pushPendingChanges();
    const pullResult = await pullServerChanges();
    const latestRevision = Math.max(pushResult.revision ?? 0, pullResult.revision ?? 0);
    await markSyncFinish(deviceState, latestRevision);
    retryBackoffMs = 0;

    return {
      status: "success",
      push: pushResult,
      pull: pullResult,
      conflicts: await getConflictLocalOperations()
    };
  } catch (error) {
    authToken = null;
    retryBackoffMs = retryBackoffMs ? Math.min(retryBackoffMs * 2, 300000) : Math.min(getRemoteConfig().syncIntervalMs * 2, 300000);
    await markSyncFailure(deviceState, error);
    return {
      status: "error",
      error: error.message
    };
  } finally {
    syncInFlight = false;
  }
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
    sessionEmail: session?.email ?? null
  };
}

export async function startBackgroundSyncLoop(intervalMs = null) {
  await ensureDeviceState();

  if (syncTimer) {
    return;
  }

  const schedule = async () => {
    await runSyncCycle().catch(() => {});
    const nextDelay = retryBackoffMs || Number(intervalMs ?? getRemoteConfig().syncIntervalMs);
    syncTimer = setTimeout(schedule, nextDelay);
  };

  syncTimer = setTimeout(schedule, Number(intervalMs ?? getRemoteConfig().syncIntervalMs));
}

export function stopBackgroundSyncLoop() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}
