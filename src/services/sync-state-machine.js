import { computeNextRetry } from "./sync-retry-scheduler.js";

export function transition(operation, event, context = {}) {
  const now = context.now ?? new Date();

  if (event === "START_ATTEMPT") {
    return {
      nextState: "IN_PROGRESS",
      patch: {
        status: "IN_PROGRESS",
        errorDetail: null,
        lastAttemptAt: now
      },
      sideEffectsMeta: { terminal: false }
    };
  }

  if (event === "APPLIED" || event === "IDEMPOTENT_REPLAY") {
    return {
      nextState: "SYNCED",
      patch: {
        status: "SYNCED",
        errorDetail: null,
        conflictPayloadJson: null,
        attempts: { increment: 1 },
        backoffMs: 0,
        nextAttemptAt: null,
        lastAttemptAt: now,
        deadLetteredAt: null
      },
      sideEffectsMeta: { terminal: true }
    };
  }

  if (event === "CONFLICT") {
    return {
      nextState: "CONFLICT",
      patch: {
        status: "CONFLICT",
        conflictPayloadJson: context.conflictPayload ?? { type: "CONFLICT", resolution: "Manual resolution required" },
        errorDetail: null,
        attempts: { increment: 1 },
        backoffMs: 0,
        nextAttemptAt: null,
        lastAttemptAt: now
      },
      sideEffectsMeta: { terminal: true }
    };
  }

  if (event === "FAIL") {
    const attempts = Number(operation.attempts ?? 0);
    const maxAttempts = Number(context.maxAttempts ?? 8);
    const nextAttempts = attempts + 1;

    if (nextAttempts >= maxAttempts) {
      return {
        nextState: "DEAD_LETTER",
        patch: {
          status: "DEAD_LETTER",
          errorDetail: context.reason,
          attempts: { increment: 1 },
          lastAttemptAt: now,
          deadLetteredAt: now,
          nextAttemptAt: null
        },
        sideEffectsMeta: { terminal: true }
      };
    }

    const nextBackoffMs = computeNextRetry(operation, context.config ?? {});
    return {
      nextState: "RETRY_SCHEDULED",
      patch: {
        status: "RETRY_SCHEDULED",
        errorDetail: context.reason,
        attempts: { increment: 1 },
        backoffMs: nextBackoffMs,
        lastAttemptAt: now,
        nextAttemptAt: new Date(now.getTime() + nextBackoffMs),
        deadLetteredAt: null
      },
      sideEffectsMeta: { terminal: false, nextBackoffMs }
    };
  }

  throw new Error(`Unknown state transition event: ${event}`);
}
