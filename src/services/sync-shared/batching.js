export function partitionSchedulableOperations(operations, shouldRetryFn, now, config) {
  const schedulableStatuses = new Set(["PENDING", "RETRY", "RETRY_SCHEDULED", "IN_PROGRESS"]);
  const pendingOperations = operations.filter((operation) => schedulableStatuses.has(operation.status));
  const dueOperations = pendingOperations.filter((operation) => shouldRetryFn(operation, now, config));
  const deferredOperations = pendingOperations.filter((operation) => !shouldRetryFn(operation, now, config));
  return { dueOperations, deferredOperations };
}
