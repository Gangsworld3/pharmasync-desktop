export class SyncOperation {
  constructor(rawOperation) {
    this.raw = rawOperation;
  }

  get id() {
    return this.raw.id;
  }

  get operationId() {
    return this.raw.operationId;
  }

  get entityId() {
    return this.raw.entityId;
  }

  maxAttempts(runtimeConfig, defaultMaxAttempts, sanitizePositiveNumber) {
    return sanitizePositiveNumber(runtimeConfig.maxOperationAttempts, defaultMaxAttempts);
  }

  conflictPayload(conflicts, mapConflict) {
    const conflict = conflicts.find((entry) => entry.entityId === this.entityId && entry.local.operationId === this.operationId);
    const enriched = mapConflict(conflict, this.raw);
    return enriched ?? { type: "CONFLICT", resolution: "Manual resolution required" };
  }
}
