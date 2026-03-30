export async function fetchPullDelta({ repo, api }) {
  const deviceState = await repo.ensureDeviceState();
  const deviceIdParam = encodeURIComponent(deviceState.deviceId);
  const result = await api.requestJson(`/sync/pull?since=${deviceState.lastPulledRevision}&deviceId=${deviceIdParam}`, {
    method: "GET"
  });
  return { deviceState, ...result };
}
