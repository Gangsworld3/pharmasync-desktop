import test from "node:test";
import assert from "node:assert/strict";

import { partitionSchedulableOperations } from "../src/services/sync-shared/batching.js";
import { computeCycleBackoffMs } from "../src/services/sync-shared/error-classification.js";

test("partitionSchedulableOperations separates due and deferred retryable operations", () => {
  const now = new Date("2026-03-31T12:00:00.000Z");
  const config = { retryBaseMs: 2500 };
  const operations = [
    { id: "op-1", status: "PENDING", nextAttemptAt: null },
    { id: "op-2", status: "RETRY_SCHEDULED", nextAttemptAt: "2026-03-31T12:10:00.000Z" },
    { id: "op-3", status: "IN_PROGRESS", nextAttemptAt: "2026-03-31T11:00:00.000Z" },
    { id: "op-4", status: "SYNCED", nextAttemptAt: null }
  ];

  const shouldRetry = (operation, nowValue) => {
    if (!operation.nextAttemptAt) return true;
    return new Date(operation.nextAttemptAt) <= nowValue;
  };

  const { dueOperations, deferredOperations } = partitionSchedulableOperations(
    operations,
    shouldRetry,
    now,
    config
  );

  assert.deepEqual(
    dueOperations.map((operation) => operation.id),
    ["op-1", "op-3"]
  );
  assert.deepEqual(
    deferredOperations.map((operation) => operation.id),
    ["op-2"]
  );
});

test("computeCycleBackoffMs doubles and caps existing backoff", () => {
  const jitterMs = (value) => value;

  const fromInterval = computeCycleBackoffMs({
    currentRetryBackoffMs: 0,
    syncIntervalMs: 15_000,
    retryMaxMs: 300_000,
    jitterMs
  });
  assert.equal(fromInterval, 30_000);

  const doubled = computeCycleBackoffMs({
    currentRetryBackoffMs: 120_000,
    syncIntervalMs: 15_000,
    retryMaxMs: 300_000,
    jitterMs
  });
  assert.equal(doubled, 240_000);

  const capped = computeCycleBackoffMs({
    currentRetryBackoffMs: 250_000,
    syncIntervalMs: 15_000,
    retryMaxMs: 300_000,
    jitterMs
  });
  assert.equal(capped, 300_000);
});
