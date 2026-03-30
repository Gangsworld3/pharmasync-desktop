import test from "node:test";
import assert from "node:assert/strict";

import { IPC_CHANNELS, createRendererApi } from "../electron/ipc-channels.js";

test("renderer IPC API maps to allowlisted channels only", async () => {
  const calls = [];
  const invoke = (channel, payload) => {
    calls.push({ channel, payload });
    return Promise.resolve({ ok: true });
  };

  const api = createRendererApi(invoke);
  await api.getCurrentUser();
  await api.getSyncStatus();
  await api.runSync();
  await api.getSummary();
  await api.getDailySalesAnalytics({ from: "2026-03-30", to: "2026-03-31" });
  await api.getTopMedicinesAnalytics({ from: "2026-03-30", to: "2026-03-31", limit: 5 });
  await api.getExpiryLossAnalytics({ days: 90 });
  await api.listClients();
  await api.listInventory();
  await api.createInventoryBatch({ sku: "SKU-1" });
  await api.updateInventoryBatch("batch-1", { quantityOnHand: 10 });
  await api.adjustInventoryBatch("batch-1", -2, "test");
  await api.listAppointments();
  await api.createInvoice({ invoiceNumber: "INV-1" });
  await api.createAppointment({ startsAt: "2026-03-31T10:00:00Z" });
  await api.printReceipt({ invoiceNumber: "INV-1" });

  const expectedChannels = new Set(Object.values(IPC_CHANNELS));
  assert.equal(calls.length, expectedChannels.size);
  for (const call of calls) {
    assert.equal(expectedChannels.has(call.channel), true, `unexpected channel: ${call.channel}`);
  }
});

test("renderer IPC API preserves payload shaping for update/adjust", async () => {
  const calls = [];
  const api = createRendererApi((channel, payload) => {
    calls.push({ channel, payload });
    return Promise.resolve({ ok: true });
  });

  await api.updateInventoryBatch("batch-9", { salePriceMinor: 1234 });
  await api.adjustInventoryBatch("batch-9", 3, "restock");

  assert.deepEqual(calls[0], {
    channel: IPC_CHANNELS.INVENTORY_UPDATE,
    payload: { batchId: "batch-9", payload: { salePriceMinor: 1234 } }
  });
  assert.deepEqual(calls[1], {
    channel: IPC_CHANNELS.INVENTORY_ADJUST,
    payload: { batchId: "batch-9", delta: 3, reason: "restock" }
  });
});
