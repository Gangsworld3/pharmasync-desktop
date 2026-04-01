export function sortServerChanges(changes) {
  return [...changes].sort((left, right) => (left.serverRevision ?? 0) - (right.serverRevision ?? 0));
}

export function buildSyncChange(operationRow) {
  return {
    operationId: operationRow.operationId,
    idempotencyKey: operationRow.idempotencyKey ?? operationRow.operationId,
    entity: operationRow.entityType,
    operation: operationRow.operation,
    entityId: operationRow.entityId,
    localRevision: operationRow.localRevision,
    data: operationRow.payloadJson ? JSON.parse(operationRow.payloadJson) : null
  };
}

export function buildSyncResultSummary(results = []) {
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

export async function markSyncStart({ desktopLog, syncRepo, deviceState, remoteBaseUrl }) {
  desktopLog.appendDesktopLog("sync.log", `sync start device=${deviceState.deviceId}`);
  return syncRepo.updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "SYNCING",
    lastSyncStartedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl
  });
}

export async function markSyncFinish({ desktopLog, syncRepo, deviceState, revision, remoteBaseUrl }) {
  desktopLog.appendDesktopLog("sync.log", `sync success device=${deviceState.deviceId} revision=${revision}`);
  return syncRepo.updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "SYNCED",
    lastPulledRevision: revision,
    lastSyncCompletedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl
  });
}

export async function markSyncFailure({ desktopLog, syncRepo, deviceState, error, remoteBaseUrl }) {
  desktopLog.appendDesktopLog("error.log", `sync failure device=${deviceState.deviceId} detail=${error.message}`);
  return syncRepo.updateDeviceState({
    deviceId: deviceState.deviceId,
    syncStatus: "ERROR",
    lastSyncError: error.message,
    lastSyncCompletedAt: new Date(),
    remoteBaseUrl
  });
}
