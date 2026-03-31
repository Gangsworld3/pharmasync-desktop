import { SyncOperation } from "./operation.js";
import { decideSyncOutcome } from "./sync-decision.js";

export function evaluatePushResult({
  rawOperation,
  result,
  conflicts,
  runtimeConfig,
  defaultMaxOperationAttempts,
  sanitizePositiveNumber,
  mapConflict,
  now
}) {
  const operation = new SyncOperation(rawOperation);
  const decision = decideSyncOutcome({
    operation,
    result,
    conflicts,
    mapConflict
  });

  if (decision.type === "SUCCESS") {
    return {
      decision,
      transitionEvent: decision.transitionEvent,
      transitionContext: { now }
    };
  }

  if (decision.type === "CONFLICT") {
    return {
      decision,
      transitionEvent: "CONFLICT",
      transitionContext: {
        now,
        conflictPayload: decision.conflictPayload
      }
    };
  }

  return {
    decision,
    transitionEvent: "FAIL",
    transitionContext: {
      reason: decision.reason,
      config: runtimeConfig,
      maxAttempts: operation.maxAttempts(runtimeConfig, defaultMaxOperationAttempts, sanitizePositiveNumber),
      now
    }
  };
}

export function evaluatePushTransportFailure({
  rawOperation,
  reason,
  runtimeConfig,
  defaultMaxOperationAttempts,
  sanitizePositiveNumber,
  now
}) {
  const operation = new SyncOperation(rawOperation);
  return {
    decision: { type: "RETRY", reason },
    transitionEvent: "FAIL",
    transitionContext: {
      reason,
      config: runtimeConfig,
      maxAttempts: operation.maxAttempts(runtimeConfig, defaultMaxOperationAttempts, sanitizePositiveNumber),
      now
    }
  };
}
