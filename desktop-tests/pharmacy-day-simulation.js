import "../src/db/init-sqlite.js";

import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/client.js";
import { createLocalClient } from "../src/db/repositories.js";
import { createInvoiceTransaction } from "../src/services/offline-service.js";
import { selectFEFOBatch } from "../desktop/src/domain/fefo.js";

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seedInventory() {
  const suffix = randomUUID().slice(0, 8);

  const skuFefoA = `SIM-FEFO-A-${suffix}`;
  const skuFefoB = `SIM-FEFO-B-${suffix}`;
  const skuNear = `SIM-NEAR-${suffix}`;
  const skuExpired = `SIM-EXPIRED-${suffix}`;

  const fefoA = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: skuFefoA,
      name: "Paracetamol",
      category: "General",
      quantityOnHand: 20,
      reorderLevel: 5,
      unitCostMinor: 100,
      salePriceMinor: 200,
      batchNumber: "A",
      expiresOn: isoDaysFromNow(15),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });
  const fefoB = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: skuFefoB,
      name: "Paracetamol",
      category: "General",
      quantityOnHand: 30,
      reorderLevel: 5,
      unitCostMinor: 100,
      salePriceMinor: 220,
      batchNumber: "B",
      expiresOn: isoDaysFromNow(180),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });
  const near = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: skuNear,
      name: "Antibiotic",
      category: "General",
      quantityOnHand: 10,
      reorderLevel: 3,
      unitCostMinor: 150,
      salePriceMinor: 300,
      batchNumber: "N1",
      expiresOn: isoDaysFromNow(20),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });
  const expired = await prisma.inventoryItem.create({
    data: {
      id: `inv-${randomUUID()}`,
      sku: skuExpired,
      name: "Expired Drug",
      category: "General",
      quantityOnHand: 5,
      reorderLevel: 1,
      unitCostMinor: 100,
      salePriceMinor: 200,
      batchNumber: "X1",
      expiresOn: isoDaysFromNow(-1),
      dirty: false,
      syncStatus: "SYNCED"
    }
  });

  return {
    fefoBatches: [fefoA, fefoB],
    near,
    expired
  };
}

async function createSimulationClient() {
  const client = await createLocalClient({
    clientCode: `SIM-${Date.now()}`,
    fullName: "Simulation Customer",
    preferredLanguage: "en"
  });
  return client.id;
}

async function run() {
  console.log("Starting pharmacy day simulation...");
  const clientId = await createSimulationClient();
  const seeded = await seedInventory();
  const selectedFefo = selectFEFOBatch(
    seeded.fefoBatches.map((batch) => ({
      batchId: batch.id,
      expiry: batch.expiresOn,
      quantity: batch.quantityOnHand,
      price: batch.salePriceMinor,
      sku: batch.sku
    }))
  );

  if (!selectedFefo) {
    throw new Error("FEFO did not return a valid batch for seeded Paracetamol data.");
  }

  const fefoInvoice = await createInvoiceTransaction({
    invoiceNumber: `SIM-FEFO-${Date.now()}`,
    clientId,
    inventorySku: selectedFefo.sku,
    inventoryBatchId: selectedFefo.batchId,
    quantity: 1,
    totalMinor: 200,
    paymentMethod: "CASH"
  }, "simulation");

  console.log("Scenario FEFO (multi-batch): selected batch", fefoInvoice.updatedInventory.batchNumber, fefoInvoice.updatedInventory.expiresOn);

  const nearInvoice = await createInvoiceTransaction({
    invoiceNumber: `SIM-NEAR-${Date.now()}`,
    clientId,
    inventorySku: seeded.near.sku,
    inventoryBatchId: seeded.near.id,
    quantity: 1,
    totalMinor: 300,
    paymentMethod: "CASH"
  }, "simulation");

  console.log("Scenario near-expiry: sold batch", nearInvoice.updatedInventory.batchNumber, nearInvoice.updatedInventory.expiresOn);

  try {
    await createInvoiceTransaction({
      invoiceNumber: `SIM-EXP-${Date.now()}`,
      clientId,
      inventorySku: seeded.expired.sku,
      inventoryBatchId: seeded.expired.id,
      quantity: 1,
      totalMinor: 200,
      paymentMethod: "CASH"
    }, "simulation");
    throw new Error("Expired stock scenario should have failed.");
  } catch (error) {
    console.log("Scenario expired stock: blocked as expected:", error.message);
  }

  console.log("Pharmacy day simulation complete.");
}

run()
  .catch((error) => {
    console.error("Simulation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
