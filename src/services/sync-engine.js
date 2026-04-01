import { desktopLog, desktopSession, syncApplyRepo, syncPorts, syncRepo } from "./sync-deps.js";
import {
  getDeferredState,
  sanitizePositiveNumber,
  shouldRetry
} from "./sync-retry-scheduler.js";
import { transition } from "./sync-state-machine.js";
import { mapConflict } from "./sync-conflict-adapter.js";
import { runPushOrchestrator } from "./sync-push/push-orchestrator.js";
import { runPullOrchestrator } from "./sync-pull/pull-orchestrator.js";
import { runSyncCycle as runSyncCyclePipeline } from "./sync-cycle-runner.js";
import { startLoop } from "./sync-loop.js";
import { createSyncRemoteApi } from "./sync-remote-api.js";
import { createRealtimeSyncController } from "./sync-realtime.js";
import {
  DEFAULT_MAX_OPERATION_ATTEMPTS,
  DEFAULT_PUSH_BATCH_SIZE,
  DEFAULT_REALTIME_RETRY_BASE_MS,
  DEFAULT_REALTIME_RETRY_MAX_MS,
  DEFAULT_RETRY_MAX_MS,
  getRemoteConfig,
  jitterMs
} from "./sync-policy.js";
import {
  buildSyncChange,
  buildSyncResultSummary,
  markSyncFailure as markSyncFailureHelper,
  markSyncFinish as markSyncFinishHelper,
  markSyncStart as markSyncStartHelper,
  sortServerChanges
} from "./sync-engine-helpers.js";

let syncTimer = null;
let syncInFlight = false;
let retryBackoffMs = 0;
let nextScheduledAt = null;
const clockPort = syncPorts.createClockPort();
const readRemoteConfig = () => getRemoteConfig(desktopSession);

function logSyncEvent(event, payload = {}) {
  desktopLog.appendDesktopJsonLog("sync.log", {
    event,
    at: new Date().toISOString(),
    ...payload
  });
}

const remoteApi = createSyncRemoteApi({
  desktopLog,
  desktopSession,
  getRemoteConfig: readRemoteConfig,
  sanitizePositiveNumber,
  jitterMs
});

const realtimeEventBus = Object.freeze({
  emit: async (eventName, payload = {}) => {
    logSyncEvent(eventName, payload);
  }
});

function buildRepoPort() {
  return syncPorts.createOperationRepoPort({
    ensureDeviceState: syncRepo.ensureDeviceState,
    getPendingLocalOperations: syncRepo.getPendingLocalOperations,
    getConflictLocalOperations: syncRepo.getConflictLocalOperations,
    recoverInProgressLocalOperations: syncRepo.recoverInProgressLocalOperations,
    updateDeviceState: syncRepo.updateDeviceState,
    applyOperationTransition,
    applyServerChange,
    appendLocalOperation: syncRepo.appendLocalOperation
  });
}

async function applyOperationTransition(operation, event, context = {}) {
  const result = transition(operation, event, context);
  await syncRepo.updateLocalOperation(operation.id, result.patch);
  return result.nextState;
}

export async function authenticateDesktopSession(email, password) {
  return remoteApi.authenticateDesktopSession(email, password);
}

export function logoutDesktopSession() {
  return remoteApi.logoutDesktopSession();
}

export async function getCurrentRemoteUser() {
  return remoteApi.getCurrentRemoteUser();
}

export async function getRemoteDailySales(params = {}) {
  return remoteApi.getRemoteDailySales(params);
}

export async function getRemoteTopMedicines(params = {}) {
  return remoteApi.getRemoteTopMedicines(params);
}

export async function getRemoteExpiryLoss(params = {}) {
  return remoteApi.getRemoteExpiryLoss(params);
}

async function markSyncStart(deviceState) {
  return markSyncStartHelper({
    desktopLog,
    syncRepo,
    deviceState,
    remoteBaseUrl: readRemoteConfig().baseUrl
  });
}

async function markSyncFinish(deviceState, revision) {
  return markSyncFinishHelper({
    desktopLog,
    syncRepo,
    deviceState,
    revision,
    remoteBaseUrl: readRemoteConfig().baseUrl
  });
}

async function markSyncFailure(deviceState, error) {
  return markSyncFailureHelper({
    desktopLog,
    syncRepo,
    deviceState,
    error,
    remoteBaseUrl: readRemoteConfig().baseUrl
  });
}

export async function recordLocalOperation(entry) {
  return syncRepo.appendLocalOperation(entry);
}

function buildPushContext() {
  return {
    repo: buildRepoPort(),
    api: syncPorts.createApiClientPort({ authorizedJsonRequest: remoteApi.authorizedJsonRequest }),
    clock: clockPort,
    config: { get: readRemoteConfig },
    policy: {
      defaultPushBatchSize: DEFAULT_PUSH_BATCH_SIZE,
      defaultMaxOperationAttempts: DEFAULT_MAX_OPERATION_ATTEMPTS
    },
    helpers: {
      shouldRetry,
      getDeferredState,
      sanitizePositiveNumber,
      buildSyncChange,
      mapConflict,
      sortServerChanges,
      logSyncEvent
    }
  };
}

export async function pushPendingChanges() {
  const result = await runPushOrchestrator(buildPushContext());
  return {
    ...result,
    resultSummary: buildSyncResultSummary(result.results ?? [])
  };
}

async function applyServerChange(change) {
  switch (change.entity) {
    case "Client":
      return syncApplyRepo.upsertClientFromServer(change);
    case "InventoryItem":
      return syncApplyRepo.upsertInventoryFromServer(change);
    case "Appointment":
      return syncApplyRepo.upsertAppointmentFromServer(change);
    case "Invoice":
      return syncApplyRepo.upsertInvoiceFromServer(change);
    case "Message":
      return syncApplyRepo.appendMessageFromServer(change);
    default:
      return null;
  }
}

function buildPullContext() {
  return {
    repo: buildRepoPort(),
    api: syncPorts.createApiClientPort({ authorizedJsonRequest: remoteApi.authorizedJsonRequest }),
    config: { get: readRemoteConfig },
    helpers: { sortServerChanges }
  };
}

export async function pullServerChanges() {
  return runPullOrchestrator(buildPullContext());
}

function buildCycleContext() {
  return {
    state: {
      getSyncInFlight: () => syncInFlight,
      setSyncInFlight: (value) => { syncInFlight = value; },
      getRetryBackoffMs: () => retryBackoffMs,
      setRetryBackoffMs: (value) => { retryBackoffMs = value; },
      setNextScheduledAt: (value) => { nextScheduledAt = value; }
    },
    repo: buildRepoPort(),
    cycle: {
      pushPendingChanges,
      pullServerChanges
    },
    auth: {
      clear: () => { remoteApi.clearAuthToken(); }
    },
    config: { get: readRemoteConfig },
    clock: clockPort,
    policy: {
      sanitizePositiveNumber,
      defaultRetryMaxMs: DEFAULT_RETRY_MAX_MS,
      jitterMs
    },
    lifecycle: {
      markSyncStart,
      markSyncFinish,
      markSyncFailure
    }
  };
}

export async function runSyncCycle() {
  return runSyncCyclePipeline(buildCycleContext());
}

const realtimeController = createRealtimeSyncController({
  desktopLog,
  desktopSession,
  getRemoteConfig: readRemoteConfig,
  runSyncCycle,
  sanitizePositiveNumber,
  defaultRealtimeRetryBaseMs: DEFAULT_REALTIME_RETRY_BASE_MS,
  defaultRealtimeRetryMaxMs: DEFAULT_REALTIME_RETRY_MAX_MS,
  eventBus: realtimeEventBus
});

export async function getSyncEngineStatus() {
  const deviceState = await syncRepo.ensureDeviceState();
  const [pendingOperations, conflictOperations] = await Promise.all([
    syncRepo.getPendingLocalOperations(),
    syncRepo.getConflictLocalOperations()
  ]);
  const session = desktopSession.getDesktopSession();

  return {
    deviceId: deviceState.deviceId,
    lastPulledRevision: deviceState.lastPulledRevision,
    syncStatus: deviceState.syncStatus,
    lastSyncStartedAt: deviceState.lastSyncStartedAt,
    lastSyncCompletedAt: deviceState.lastSyncCompletedAt,
    lastSyncError: deviceState.lastSyncError,
    pendingOperations: pendingOperations.length,
    conflicts: conflictOperations.length,
    remoteBaseUrl: deviceState.remoteBaseUrl ?? readRemoteConfig().baseUrl,
    authenticated: Boolean(session?.accessToken),
    sessionEmail: session?.email ?? null,
    sessionRole: session?.role ?? null,
    sessionTenantId: session?.tenantId ?? null,
    retryBackoffMs,
    nextScheduledAt: nextScheduledAt?.toISOString() ?? null
  };
}

function buildLoopContext() {
  return {
    repo: buildRepoPort(),
    state: {
      getSyncTimer: () => syncTimer,
      setSyncTimer: (value) => { syncTimer = value; },
      getRetryBackoffMs: () => retryBackoffMs,
      setNextScheduledAt: (value) => { nextScheduledAt = value; }
    },
    realtime: {
      start: realtimeController.startRealtimeSyncListener,
      stop: realtimeController.stopRealtimeSyncListener
    },
    cycle: {
      runSyncCycle
    },
    config: { get: readRemoteConfig },
    clock: clockPort
  };
}

export async function startBackgroundSyncLoop(intervalMs = null) {
  return startLoop(buildLoopContext(), intervalMs);
}
