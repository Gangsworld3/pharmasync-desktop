import { prisma } from "../client.js";

const activeOnly = { deletedAt: null };

export function listInvoices() {
  return prisma.invoice.findMany({
    where: activeOnly,
    include: { client: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function createInvoiceWithDependencies(tx, payload) {
  const now = Date.now();
  const quantity = Number(payload.quantity ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  let candidates = [];
  if (payload.inventoryBatchId) {
    const preferredBatch = await tx.inventoryItem.findUnique({
      where: { id: payload.inventoryBatchId }
    });
    if (!preferredBatch || preferredBatch.deletedAt) {
      throw new Error(`Inventory batch ${payload.inventoryBatchId} not found.`);
    }
    candidates = await tx.inventoryItem.findMany({
      where: {
        name: preferredBatch.name,
        category: preferredBatch.category,
        deletedAt: null
      }
    });
  } else if (payload.productName) {
    candidates = await tx.inventoryItem.findMany({
      where: {
        name: payload.productName,
        ...(payload.productCategory ? { category: payload.productCategory } : {}),
        deletedAt: null
      }
    });
  } else {
    candidates = await tx.inventoryItem.findMany({
      where: { sku: payload.inventorySku, deletedAt: null }
    });
  }

  if (candidates.length === 0) {
    throw new Error(`Inventory item ${payload.inventorySku ?? payload.productName ?? "unknown"} not found.`);
  }

  const validCandidates = candidates
    .filter((item) => Number(item.quantityOnHand ?? 0) > 0)
    .filter((item) => {
      if (!item.expiresOn) return true;
      const expiresAt = new Date(item.expiresOn).getTime();
      return Number.isFinite(expiresAt) && expiresAt > now;
    })
    .sort((left, right) => {
      const leftExpiry = left.expiresOn ? new Date(left.expiresOn).getTime() : Number.POSITIVE_INFINITY;
      const rightExpiry = right.expiresOn ? new Date(right.expiresOn).getTime() : Number.POSITIVE_INFINITY;
      return leftExpiry - rightExpiry;
    });

  const totalAvailable = validCandidates.reduce((sum, item) => sum + Number(item.quantityOnHand ?? 0), 0);
  if (totalAvailable < quantity) {
    const hasExpired = candidates.some((item) => item.expiresOn && new Date(item.expiresOn).getTime() <= now);
    if (hasExpired && totalAvailable <= 0) {
      throw new Error(`Cannot sell expired batch for ${payload.inventorySku ?? payload.productName ?? "item"}.`);
    }
    throw new Error(`Insufficient stock for ${payload.inventorySku ?? payload.productName ?? "item"}.`);
  }

  const allocations = [];
  let remaining = quantity;
  for (const batch of validCandidates) {
    if (remaining <= 0) break;
    const available = Number(batch.quantityOnHand ?? 0);
    const consume = Math.min(available, remaining);
    if (consume <= 0) continue;
    allocations.push({ batchId: batch.id, quantity: consume });
    remaining -= consume;
  }

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber: payload.invoiceNumber,
      clientId: payload.clientId,
      currencyCode: payload.currencyCode ?? "SSP",
      totalMinor: payload.totalMinor,
      balanceDueMinor: payload.balanceDueMinor ?? payload.totalMinor,
      paymentMethod: payload.paymentMethod,
      status: payload.status ?? "ISSUED",
      issuedAt: new Date(),
      dirty: true,
      syncStatus: "PENDING",
      localRevision: 1
    }
  });

  const updatedInventories = [];
  for (const allocation of allocations) {
    const decrementResult = await tx.inventoryItem.updateMany({
      where: {
        id: allocation.batchId,
        quantityOnHand: { gte: allocation.quantity },
        deletedAt: null
      },
      data: {
        quantityOnHand: { decrement: allocation.quantity },
        dirty: true,
        syncStatus: "PENDING",
        localRevision: { increment: 1 }
      }
    });

    if (decrementResult.count !== 1) {
      throw new Error(`Insufficient stock for selected batch: ${allocation.batchId}`);
    }

    const updatedInventory = await tx.inventoryItem.findUnique({
      where: { id: allocation.batchId }
    });

    if (!updatedInventory) {
      throw new Error(`Batch not found after stock update: ${allocation.batchId}`);
    }

    updatedInventories.push(updatedInventory);
  }

  return {
    invoice,
    allocations,
    updatedInventories,
    updatedInventory: updatedInventories[0] ?? null
  };
}
