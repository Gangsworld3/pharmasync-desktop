import { SyncResultType } from "./sync-result.js";

export function decideSyncOutcome({ operation, result, conflicts, mapConflict }) {
  if (!result) {
    return {
      type: SyncResultType.RETRY,
      reason: "Push result missing for operation; scheduled retry."
    };
  }

  if (result.status === "APPLIED" || result.status === "IDEMPOTENT_REPLAY") {
    return {
      type: SyncResultType.SUCCESS,
      transitionEvent: result.status
    };
  }

  if (result.status === "CONFLICT") {
    return {
      type: SyncResultType.CONFLICT,
      conflictPayload: operation.conflictPayload(conflicts, mapConflict)
    };
  }

  return {
    type: SyncResultType.RETRY,
    reason: result.error ?? "Remote rejection"
  };
}
