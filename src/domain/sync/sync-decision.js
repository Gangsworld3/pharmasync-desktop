export function decideSyncOutcome({ operation, result, conflicts, mapConflict }) {
  if (!result) {
    return {
      type: "RETRY",
      reason: "Push result missing for operation; scheduled retry."
    };
  }

  if (result.status === "APPLIED" || result.status === "IDEMPOTENT_REPLAY") {
    return {
      type: "SUCCESS",
      transitionEvent: result.status
    };
  }

  if (result.status === "CONFLICT") {
    return {
      type: "CONFLICT",
      conflictPayload: operation.conflictPayload(conflicts, mapConflict)
    };
  }

  return {
    type: "RETRY",
    reason: result.error ?? "Remote rejection"
  };
}
