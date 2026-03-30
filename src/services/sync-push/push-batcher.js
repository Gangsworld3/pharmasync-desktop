import { partitionSchedulableOperations } from "../sync-shared/batching.js";

export function buildPushPlan({ operations, shouldRetry, now, config, getDeferredState, defaultPushBatchSize, sanitizePositiveNumber }) {
  const { dueOperations, deferredOperations } = partitionSchedulableOperations(operations, shouldRetry, now, config);

  if (!dueOperations.length) {
    return {
      dueOperations,
      deferredOperations,
      batches: [],
      deferredOperationStates: deferredOperations.map((operation) => getDeferredState(operation, now, config))
    };
  }

  const batchSize = Math.max(1, sanitizePositiveNumber(config.pushBatchSize, defaultPushBatchSize));
  const batches = [];
  for (let index = 0; index < dueOperations.length; index += batchSize) {
    batches.push(dueOperations.slice(index, index + batchSize));
  }

  return {
    dueOperations,
    deferredOperations,
    batches,
    deferredOperationStates: deferredOperations.map((operation) => getDeferredState(operation, now, config))
  };
}
