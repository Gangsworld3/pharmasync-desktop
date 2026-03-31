function sortOperationsDeterministically(operations) {
  return [...operations].sort((left, right) => {
    const leftCreatedAt = left?.createdAt ? new Date(left.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const rightCreatedAt = right?.createdAt ? new Date(right.createdAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    const leftId = String(left?.id ?? left?.operationId ?? "");
    const rightId = String(right?.id ?? right?.operationId ?? "");
    if (leftId !== rightId) {
      return leftId.localeCompare(rightId);
    }

    return String(left?.operationId ?? "").localeCompare(String(right?.operationId ?? ""));
  });
}

export function partitionSchedulableOperations(operations, shouldRetryFn, now, config) {
  const schedulableStatuses = new Set(["PENDING", "RETRY", "RETRY_SCHEDULED", "IN_PROGRESS"]);
  const pendingOperations = sortOperationsDeterministically(
    operations.filter((operation) => schedulableStatuses.has(operation.status))
  );
  const dueOperations = pendingOperations.filter((operation) => shouldRetryFn(operation, now, config));
  const deferredOperations = pendingOperations.filter((operation) => !shouldRetryFn(operation, now, config));
  return { dueOperations, deferredOperations };
}
