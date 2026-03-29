export async function pullServerChanges(context) {
  const {
    ensureDeviceState,
    authorizedJsonRequest,
    sortServerChanges,
    applyServerChange,
    updateDeviceState,
    getRemoteConfig
  } = context;

  const deviceState = await ensureDeviceState();
  const deviceIdParam = encodeURIComponent(deviceState.deviceId);
  const { response, body } = await authorizedJsonRequest(`/sync/pull?since=${deviceState.lastPulledRevision}&deviceId=${deviceIdParam}`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Pull failed (${response.status}).`);
  }

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
