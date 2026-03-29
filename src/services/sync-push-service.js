export async function pushPendingChanges(context) {
  const {
    ensureDeviceState,
    getRemoteConfig,
    getPendingLocalOperations,
    shouldRetry,
    getDeferredState,
    sanitizePositiveNumber,
    defaultPushBatchSize,
    buildSyncChange,
    authorizedJsonRequest,
    applyOperationTransition,
    mapConflict,
    applyServerChange,
    sortServerChanges,
    defaultMaxOperationAttempts
  } = context;

  const deviceState = await ensureDeviceState();
  const config = getRemoteConfig();
  const allPendingOperations = await getPendingLocalOperations();
  const now = new Date();
  const schedulableStatuses = new Set(["PENDING", "RETRY", "RETRY_SCHEDULED", "IN_PROGRESS"]);
  const pendingOperations = allPendingOperations.filter((operation) => schedulableStatuses.has(operation.status));
  const dueOperations = pendingOperations.filter((operation) => shouldRetry(operation, now, config));
  const deferredOperations = pendingOperations.filter((operation) => !shouldRetry(operation, now, config));

  if (!dueOperations.length) {
    return {
      pushed: 0,
      revision: deviceState.lastPulledRevision,
      results: [],
      deferred: deferredOperations.length,
      deferredOperations: deferredOperations.map((operation) => getDeferredState(operation, now, config))
    };
  }

  const batchSize = Math.max(1, sanitizePositiveNumber(config.pushBatchSize, defaultPushBatchSize));
  const aggregatedResults = [];
  const aggregatedServerChanges = [];
  let latestRevision = deviceState.lastPulledRevision;

  for (let index = 0; index < dueOperations.length; index += batchSize) {
    const batch = dueOperations.slice(index, index + batchSize);
    const batchAttemptStartedAt = new Date();
    for (const operation of batch) {
      await applyOperationTransition(operation, "START_ATTEMPT", { now: batchAttemptStartedAt });
    }

    const payload = {
      deviceId: deviceState.deviceId,
      lastPulledRevision: latestRevision,
      changes: batch.map(buildSyncChange)
    };

    let response;
    let body;
    try {
      const result = await authorizedJsonRequest("/sync/push", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      response = result.response;
      body = result.body;
    } catch (error) {
      for (const operation of batch) {
        await applyOperationTransition(operation, "FAIL", {
          reason: error.message || "Push request failed",
          config,
          maxAttempts: sanitizePositiveNumber(config.maxOperationAttempts, defaultMaxOperationAttempts),
          now: new Date()
        });
      }
      throw error;
    }

    if (!response.ok) {
      for (const operation of batch) {
        await applyOperationTransition(operation, "FAIL", {
          reason: `Push failed (${response.status})`,
          config,
          maxAttempts: sanitizePositiveNumber(config.maxOperationAttempts, defaultMaxOperationAttempts),
          now: new Date()
        });
      }
      throw new Error(`Push failed (${response.status}).`);
    }

    const results = body.data?.results ?? [];
    const conflicts = body.data?.conflicts ?? [];
    const serverChanges = sortServerChanges(body.data?.serverChanges ?? []);

    for (const operation of batch) {
      const result = results.find((entry) => entry.operationId === operation.operationId);
      if (!result) {
        await applyOperationTransition(operation, "FAIL", {
          reason: "Push result missing for operation; scheduled retry.",
          config,
          maxAttempts: sanitizePositiveNumber(config.maxOperationAttempts, defaultMaxOperationAttempts),
          now: new Date()
        });
        continue;
      }

      if (result.status === "APPLIED" || result.status === "IDEMPOTENT_REPLAY") {
        await applyOperationTransition(operation, result.status, { now: new Date() });
        continue;
      }

      if (result.status === "CONFLICT") {
        const conflict = conflicts.find((entry) => entry.entityId === operation.entityId && entry.local.operationId === operation.operationId);
        const enrichedConflict = mapConflict(conflict, operation);
        await applyOperationTransition(operation, "CONFLICT", {
          now: new Date(),
          conflictPayload: enrichedConflict ?? { type: "CONFLICT", resolution: "Manual resolution required" }
        });
        continue;
      }

      await applyOperationTransition(operation, "FAIL", {
        reason: result.error ?? "Remote rejection",
        config,
        maxAttempts: sanitizePositiveNumber(config.maxOperationAttempts, defaultMaxOperationAttempts),
        now: new Date()
      });
    }

    for (const change of serverChanges) {
      await applyServerChange(change);
    }

    aggregatedResults.push(...results);
    aggregatedServerChanges.push(...serverChanges);
    latestRevision = Math.max(latestRevision, body.meta?.revision ?? latestRevision);
  }

  return {
    pushed: dueOperations.length,
    revision: latestRevision,
    serverChanges: aggregatedServerChanges,
    results: aggregatedResults,
    deferred: deferredOperations.length,
    deferredOperations: deferredOperations.map((operation) => getDeferredState(operation, now, config))
  };
}
