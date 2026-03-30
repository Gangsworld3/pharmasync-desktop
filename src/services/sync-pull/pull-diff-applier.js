export async function applyPullDelta({ repo, helpers, body, deviceState, config }) {
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
