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

  return {
    results,
    serverChanges
  };
}
