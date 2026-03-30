import test from "node:test";
import assert from "node:assert/strict";
import { isExpired, isNearExpiry, selectFEFOBatch } from "../desktop/src/domain/fefo.js";

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

test("selectFEFOBatch picks earliest non-expired batch with stock", () => {
  const batch = selectFEFOBatch([
    { batchId: "b-expired", expiry: isoDaysFromNow(-2), quantity: 10, price: 100 },
    { batchId: "b-late", expiry: isoDaysFromNow(120), quantity: 10, price: 100 },
    { batchId: "b-early", expiry: isoDaysFromNow(15), quantity: 10, price: 100 }
  ]);

  assert.equal(batch?.batchId, "b-early");
});

test("selectFEFOBatch returns null when all batches are invalid", () => {
  const batch = selectFEFOBatch([
    { batchId: "b-expired", expiry: isoDaysFromNow(-1), quantity: 20, price: 100 },
    { batchId: "b-empty", expiry: isoDaysFromNow(40), quantity: 0, price: 100 }
  ]);

  assert.equal(batch, null);
});

test("expiry helpers classify near-expiry and expired dates", () => {
  assert.equal(isExpired(isoDaysFromNow(-1)), true);
  assert.equal(isNearExpiry(isoDaysFromNow(20)), true);
  assert.equal(isNearExpiry(isoDaysFromNow(150)), false);
});
