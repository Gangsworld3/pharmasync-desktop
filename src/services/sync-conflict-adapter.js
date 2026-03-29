function buildConflictFieldDiff(localData, serverData) {
  if (!localData || !serverData || typeof localData !== "object" || typeof serverData !== "object") {
    return null;
  }

  const keys = new Set([...Object.keys(localData), ...Object.keys(serverData)]);
  const fieldDiff = {};

  for (const key of keys) {
    const localValue = localData[key];
    const serverValue = serverData[key];
    if (JSON.stringify(localValue) !== JSON.stringify(serverValue)) {
      fieldDiff[key] = [localValue ?? null, serverValue ?? null];
    }
  }

  return Object.keys(fieldDiff).length ? fieldDiff : null;
}

function parsePayloadJson(raw) {
  return raw ? JSON.parse(raw) : null;
}

export function mapConflict(serverPayload, localOp, context = {}) {
  const localData = serverPayload?.local?.data ?? parsePayloadJson(localOp.payloadJson);
  const serverData = serverPayload?.server ?? null;
  const fieldDiff = buildConflictFieldDiff(localData, serverData);

  return {
    ...(serverPayload ?? {}),
    localVersion: localOp.localRevision ?? null,
    serverVersion: serverPayload?.serverRevision ?? serverData?.server_revision ?? null,
    fieldDiff,
    ...(context.extra ?? {})
  };
}
