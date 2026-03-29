import { partitionSchedulableOperations } from "./sync-shared/batching.js";

export async function pushPendingChanges({ repo, api, clock, config, policy, helpers }) {
  const deviceState = await repo.ensureDeviceState();
  const runtimeConfig = config.get();
  const allPendingOperations = await repo.listPendingOperations();
  const now = clock.now();
  const { dueOperations, deferredOperations } = partitionSchedulableOperations(
    allPendingOperations,
    helpers.shouldRetry,
    now,
    runtimeConfig
  );

  if (!dueOperations.length) {
    return {
      pushed: 0,
      revision: deviceState.lastPulledRevision,
      results: [],
      deferred: deferredOperations.length,
      deferredOperations: deferredOperations.map((operation) => helpers.getDeferredState(operation, now, runtimeConfig))
    };
  }

  const batchSize = Math.max(1, helpers.sanitizePositiveNumber(runtimeConfig.pushBatchSize, policy.defaultPushBatchSize));
  const aggregatedResults = [];
  const aggregatedServerChanges = [];
  let latestRevision = deviceState.lastPulledRevision;

  for (let index = 0; index < dueOperations.length; index += batchSize) {
    const batch = dueOperations.slice(index, index + batchSize);
    const batchAttemptStartedAt = clock.now();
    for (const operation of batch) {
      await repo.applyTransition(operation, "START_ATTEMPT", { now: batchAttemptStartedAt });
    }

    const payload = {
      deviceId: deviceState.deviceId,
      lastPulledRevision: latestRevision,
      changes: batch.map(helpers.buildSyncChange)
    };

    let response;
    let body;
    try {
      const result = await api.requestJson("/sync/push", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      response = result.response;
      body = result.body;
    } catch (error) {
      for (const operation of batch) {
        await repo.applyTransition(operation, "FAIL", {
          reason: error.message || "Push request failed",
          config: runtimeConfig,
          maxAttempts: helpers.sanitizePositiveNumber(runtimeConfig.maxOperationAttempts, policy.defaultMaxOperationAttempts),
          now: clock.now()
        });
      }
      throw error;
    }

    if (!response.ok) {
      for (const operation of batch) {
        await repo.applyTransition(operation, "FAIL", {
          reason: `Push failed (${response.status})`,
          config: runtimeConfig,
          maxAttempts: helpers.sanitizePositiveNumber(runtimeConfig.maxOperationAttempts, policy.defaultMaxOperationAttempts),
          now: clock.now()
        });
      }
      throw new Error(`Push failed (${response.status}).`);
    }

    const results = body.data?.results ?? [];
    const conflicts = body.data?.conflicts ?? [];
    const serverChanges = helpers.sortServerChanges(body.data?.serverChanges ?? []);

    for (const operation of batch) {
      const result = results.find((entry) => entry.operationId === operation.operationId);
      if (!result) {
        await repo.applyTransition(operation, "FAIL", {
          reason: "Push result missing for operation; scheduled retry.",
          config: runtimeConfig,
          maxAttempts: helpers.sanitizePositiveNumber(runtimeConfig.maxOperationAttempts, policy.defaultMaxOperationAttempts),
          now: clock.now()
        });
        continue;
      }

      if (result.status === "APPLIED" || result.status === "IDEMPOTENT_REPLAY") {
        await repo.applyTransition(operation, result.status, { now: clock.now() });
        continue;
      }

      if (result.status === "CONFLICT") {
        const conflict = conflicts.find((entry) => entry.entityId === operation.entityId && entry.local.operationId === operation.operationId);
        const enrichedConflict = helpers.mapConflict(conflict, operation);
        await repo.applyTransition(operation, "CONFLICT", {
          now: clock.now(),
          conflictPayload: enrichedConflict ?? { type: "CONFLICT", resolution: "Manual resolution required" }
        });
        continue;
      }

      await repo.applyTransition(operation, "FAIL", {
        reason: result.error ?? "Remote rejection",
        config: runtimeConfig,
        maxAttempts: helpers.sanitizePositiveNumber(runtimeConfig.maxOperationAttempts, policy.defaultMaxOperationAttempts),
        now: clock.now()
      });
    }

    for (const change of serverChanges) {
      await repo.applyServerChange(change);
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
    deferredOperations: deferredOperations.map((operation) => helpers.getDeferredState(operation, now, runtimeConfig))
  };
}
