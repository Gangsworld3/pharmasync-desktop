import { randomUUID } from "node:crypto";
import { prisma } from "../client.js";
import { appendLocalOperation } from "./syncRepo.js";

const activeOnly = { deletedAt: null };

async function ensureUniqueInventorySku(tx, proposedSku) {
  const base = String(proposedSku ?? "").trim();
  if (!base) {
    throw new Error("SKU is required.");
  }

  let candidate = base;
  let suffix = 2;
  while (await tx.inventoryItem.findFirst({ where: { sku: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildInventoryPayload(item) {
  return {
    sku: item.sku,
    name: item.name,
    category: item.category,
    quantity_on_hand: item.quantityOnHand,
    reorder_level: item.reorderLevel,
    unit_cost_minor: item.unitCostMinor,
    sale_price_minor: item.salePriceMinor,
    batch_number: item.batchNumber,
    expires_on: item.expiresOn
  };
}

export function listInventory() {
  return prisma.inventoryItem.findMany({
    where: activeOnly,
    orderBy: [{ name: "asc" }, { expiresOn: "asc" }, { batchNumber: "asc" }]
  });
}

export async function createLocalInventoryBatch(payload) {
  return prisma.$transaction(async (tx) => {
    const sku = await ensureUniqueInventorySku(tx, payload.sku);
    const created = await tx.inventoryItem.create({
      data: {
        id: payload.id ?? `inv-${randomUUID()}`,
        sku,
        name: payload.name ?? "Unnamed medicine",
        category: payload.category ?? "General",
        quantityOnHand: Number(payload.quantityOnHand ?? payload.quantity_on_hand ?? 0),
        reorderLevel: Number(payload.reorderLevel ?? payload.reorder_level ?? 0),
        unitCostMinor: Number(payload.unitCostMinor ?? payload.unit_cost_minor ?? 0),
        salePriceMinor: Number(payload.salePriceMinor ?? payload.sale_price_minor ?? 0),
        batchNumber: payload.batchNumber ?? payload.batch_number ?? null,
        expiresOn: (payload.expiresOn ?? payload.expires_on)
          ? new Date(payload.expiresOn ?? payload.expires_on)
          : null,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: 1,
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId: payload.operationId ?? `local-op-${randomUUID()}`,
      entityType: "InventoryItem",
      entityId: created.id,
      operation: "CREATE",
      localRevision: created.localRevision,
      payload: buildInventoryPayload(created)
    });

    return created;
  });
}

export async function updateLocalInventoryBatch(id, payload) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new Error("Inventory batch not found.");
    }

    const updated = await tx.inventoryItem.update({
      where: { id },
      data: {
        name: payload.name ?? existing.name,
        category: payload.category ?? existing.category,
        quantityOnHand: payload.quantityOnHand ?? payload.quantity_on_hand ?? existing.quantityOnHand,
        reorderLevel: payload.reorderLevel ?? payload.reorder_level ?? existing.reorderLevel,
        unitCostMinor: payload.unitCostMinor ?? payload.unit_cost_minor ?? existing.unitCostMinor,
        salePriceMinor: payload.salePriceMinor ?? payload.sale_price_minor ?? existing.salePriceMinor,
        batchNumber: payload.batchNumber ?? payload.batch_number ?? existing.batchNumber,
        expiresOn: (() => {
          if (payload.expiresOn === null || payload.expires_on === null) return null;
          if (payload.expiresOn ?? payload.expires_on) {
            return new Date(payload.expiresOn ?? payload.expires_on);
          }
          return existing.expiresOn;
        })(),
        dirty: true,
        syncStatus: "PENDING",
        localRevision: { increment: 1 },
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId: payload.operationId ?? `local-op-${randomUUID()}`,
      entityType: "InventoryItem",
      entityId: updated.id,
      operation: "UPDATE",
      localRevision: updated.localRevision,
      payload: buildInventoryPayload(updated)
    });

    return updated;
  });
}

export async function adjustLocalInventoryBatch(id, delta, reason = "manual-adjustment") {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new Error("Inventory batch not found.");
    }

    const nextQuantity = Number(existing.quantityOnHand) + Number(delta);
    if (nextQuantity < 0) {
      throw new Error("Adjustment would make stock negative.");
    }

    const updated = await tx.inventoryItem.update({
      where: { id },
      data: {
        quantityOnHand: nextQuantity,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: { increment: 1 },
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId: `local-op-${randomUUID()}`,
      entityType: "InventoryItem",
      entityId: updated.id,
      operation: "UPDATE",
      localRevision: updated.localRevision,
      payload: {
        ...buildInventoryPayload(updated),
        adjustment_reason: reason,
        adjustment_delta: Number(delta)
      }
    });

    return updated;
  });
}
