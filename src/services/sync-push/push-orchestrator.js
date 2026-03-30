import { buildPushPlan } from "./push-batcher.js";
import { executePushBatch } from "./push-executor.js";
import { handlePushBatchResult } from "./push-result-handler.js";

export async function runPushOrchestrator({ repo, api, clock, config, policy, helpers }) {
  const deviceState = await repo.ensureDeviceState();
  const runtimeConfig = config.get();
  const allPendingOperations = await repo.listPendingOperations();
  const now = clock.now();

  const plan = buildPushPlan({
    operations: allPendingOperations,
    shouldRetry: helpers.shouldRetry,
    now,
    config: runtimeConfig,
    getDeferredState: helpers.getDeferredState,
    defaultPushBatchSize: policy.defaultPushBatchSize,
    sanitizePositiveNumber: helpers.sanitizePositiveNumber
  });

  if (!plan.batches.length) {
    return {
      pushed: 0,
      revision: deviceState.lastPulledRevision,
      results: [],
      deferred: plan.deferredOperations.length,
      deferredOperations: plan.deferredOperationStates
    };
  }

  const aggregatedResults = [];
  const aggregatedServerChanges = [];
  let latestRevision = deviceState.lastPulledRevision;

  for (const batch of plan.batches) {
    const batchAttemptStartedAt = clock.now();
    for (const operation of batch) {
      await repo.applyTransition(operation, "START_ATTEMPT", { now: batchAttemptStartedAt });
    }

    let response;
    let body;
    try {
      const result = await executePushBatch({
        api,
        deviceId: deviceState.deviceId,
        latestRevision,
        batch,
        buildSyncChange: helpers.buildSyncChange
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

    const handled = await handlePushBatchResult({
      batch,
      response,
      body,
      repo,
      helpers,
      runtimeConfig,
      policy,
      clock
    });

    aggregatedResults.push(...handled.results);
    aggregatedServerChanges.push(...handled.serverChanges);
    latestRevision = Math.max(latestRevision, body.meta?.revision ?? latestRevision);
  }

  return {
    pushed: plan.dueOperations.length,
    revision: latestRevision,
    serverChanges: aggregatedServerChanges,
    results: aggregatedResults,
    deferred: plan.deferredOperations.length,
    deferredOperations: plan.deferredOperationStates
  };
}
