import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "../src/db/init-sqlite.js";
import { prisma } from "../src/db/client.js";
import { createLocalClient } from "../src/db/repositories.js";
import { createInvoiceTransaction } from "../src/services/offline-service.js";

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

test("auto-splits sale across FEFO batches when preferred batch stock is low", async () => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Split Drug ${suffix}`;
  const category = "Split Test";

  const batchA = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: `SPLIT-A-${suffix}`,
      name,
      category,
      quantityOnHand: 1,
      reorderLevel: 0,
      unitCostMinor: 100,
      salePriceMinor: 200,
      batchNumber: "A",
      expiresOn: isoDaysFromNow(10),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });

  const batchB = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: `SPLIT-B-${suffix}`,
      name,
      category,
      quantityOnHand: 5,
      reorderLevel: 0,
      unitCostMinor: 100,
      salePriceMinor: 200,
      batchNumber: "B",
      expiresOn: isoDaysFromNow(120),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });

  const client = await createLocalClient({
    clientCode: `SPLIT-CLI-${suffix}`,
    fullName: "Split Test Client",
    preferredLanguage: "en"
  });

  const result = await createInvoiceTransaction({
    invoiceNumber: `SPLIT-INV-${suffix}`,
    clientId: client.id,
    inventorySku: batchA.sku,
    inventoryBatchId: batchA.id,
    productName: name,
    productCategory: category,
    quantity: 3,
    totalMinor: 600,
    paymentMethod: "CASH"
  }, "test");

  assert.equal(result.allocations.length, 2);
  assert.deepEqual(result.allocations, [
    { batchId: batchA.id, quantity: 1 },
    { batchId: batchB.id, quantity: 2 }
  ]);

  const refreshedA = await prisma.inventoryItem.findUnique({ where: { id: batchA.id } });
  const refreshedB = await prisma.inventoryItem.findUnique({ where: { id: batchB.id } });
  assert.equal(Number(refreshedA.quantityOnHand), 0);
  assert.equal(Number(refreshedB.quantityOnHand), 3);
});
