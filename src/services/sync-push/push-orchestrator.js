import { buildPushPlan } from "./push-batcher.js";
import { executePushBatch } from "./push-executor.js";
import { parsePushBatchResult } from "./push-result-handler.js";
import { evaluateSync, evaluateSyncTransportFailure } from "../../domain/sync/index.js";

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
        const evaluation = evaluateSyncTransportFailure({
          rawOperation: operation,
          reason: error.message || "Push request failed",
          runtimeConfig,
          defaultMaxOperationAttempts: policy.defaultMaxOperationAttempts,
          sanitizePositiveNumber: helpers.sanitizePositiveNumber,
          now: clock.now()
        });
        await repo.applyTransition(operation, evaluation.transitionEvent, evaluation.transitionContext);
      }
      throw error;
    }

    const handled = parsePushBatchResult({ response, body, helpers });

    if (!handled.ok) {
      for (const operation of batch) {
        const evaluation = evaluateSync({
          rawOperation: operation,
          result: { status: "RETRY", error: `Push failed (${handled.status})` },
          conflicts: [],
          runtimeConfig,
          defaultMaxOperationAttempts: policy.defaultMaxOperationAttempts,
          sanitizePositiveNumber: helpers.sanitizePositiveNumber,
          mapConflict: helpers.mapConflict,
          now: clock.now()
        });
        await repo.applyTransition(operation, evaluation.transitionEvent, evaluation.transitionContext);
      }
      throw new Error(`Push failed (${handled.status}).`);
    }

    for (const operation of batch) {
      const result = handled.results.find((entry) => entry.operationId === operation.operationId);
      const evaluation = evaluateSync({
        rawOperation: operation,
        result,
        conflicts: handled.conflicts,
        runtimeConfig,
        defaultMaxOperationAttempts: policy.defaultMaxOperationAttempts,
        sanitizePositiveNumber: helpers.sanitizePositiveNumber,
        mapConflict: helpers.mapConflict,
        now: clock.now()
      });
      await repo.applyTransition(operation, evaluation.transitionEvent, evaluation.transitionContext);
    }

    for (const change of handled.serverChanges) {
      await repo.applyServerChange(change);
    }

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
