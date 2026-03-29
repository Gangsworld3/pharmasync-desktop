export async function pullServerChanges({ repo, api, config, helpers }) {
  const deviceState = await repo.ensureDeviceState();
  const deviceIdParam = encodeURIComponent(deviceState.deviceId);
  const { response, body } = await api.requestJson(`/sync/pull?since=${deviceState.lastPulledRevision}&deviceId=${deviceIdParam}`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Pull failed (${response.status}).`);
  }

  const serverChanges = helpers.sortServerChanges(body.data.serverChanges ?? []);
  for (const change of serverChanges) {
    await repo.applyServerChange(change);
  }

  await repo.updateDeviceState({
    deviceId: deviceState.deviceId,
    lastPulledRevision: body.meta.revision,
    syncStatus: "SYNCED",
    lastSyncCompletedAt: new Date(),
    lastSyncError: null,
    remoteBaseUrl: config.get().baseUrl
  });

  return {
    pulled: serverChanges.length,
    revision: body.meta.revision,
    serverChanges
  };
}
