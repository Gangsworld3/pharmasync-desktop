export async function executePushBatch({ api, deviceId, latestRevision, batch, buildSyncChange }) {
  const payload = {
    deviceId,
    lastPulledRevision: latestRevision,
    changes: batch.map(buildSyncChange)
  };

  return api.requestJson("/sync/push", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
