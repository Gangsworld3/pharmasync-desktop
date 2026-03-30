import {
  adjustLocalInventoryBatch,
  createLocalInventoryBatch,
  listInventory,
  updateLocalInventoryBatch
} from "../db/repositories.js";

export function listInventoryBatches() {
  return listInventory();
}

export function createInventoryBatch(payload) {
  return createLocalInventoryBatch(payload);
}

export function updateInventoryBatch(batchId, payload) {
  return updateLocalInventoryBatch(batchId, payload);
}

export function adjustInventoryBatch(batchId, delta, reason = "manual-adjustment") {
  return adjustLocalInventoryBatch(batchId, Number(delta ?? 0), reason);
}
