import { evaluatePushResult } from "../../domain/sync/sync-decision-engine.js";

export async function handlePushBatchResult({
  batch,
  response,
  body,
  repo,
  helpers,
  runtimeConfig,
  policy,
  clock
}) {
  if (!response.ok) {
    for (const operation of batch) {
      const evaluation = evaluatePushResult({
        rawOperation: operation,
        result: { status: "RETRY", error: `Push failed (${response.status})` },
        conflicts: [],
        runtimeConfig,
        defaultMaxOperationAttempts: policy.defaultMaxOperationAttempts,
        sanitizePositiveNumber: helpers.sanitizePositiveNumber,
        mapConflict: helpers.mapConflict,
        now: clock.now()
      });
      await repo.applyTransition(operation, evaluation.transitionEvent, evaluation.transitionContext);
    }
    throw new Error(`Push failed (${response.status}).`);
  }

  const results = body.data?.results ?? [];
  const conflicts = body.data?.conflicts ?? [];
  const serverChanges = helpers.sortServerChanges(body.data?.serverChanges ?? []);

  for (const operation of batch) {
    const result = results.find((entry) => entry.operationId === operation.operationId);
    const evaluation = evaluatePushResult({
      rawOperation: operation,
      result,
      conflicts,
      runtimeConfig,
      defaultMaxOperationAttempts: policy.defaultMaxOperationAttempts,
      sanitizePositiveNumber: helpers.sanitizePositiveNumber,
      mapConflict: helpers.mapConflict,
      now: clock.now()
    });
    await repo.applyTransition(operation, evaluation.transitionEvent, evaluation.transitionContext);
  }

  for (const change of serverChanges) {
    await repo.applyServerChange(change);
  }

  return {
    results,
    serverChanges
  };
}
