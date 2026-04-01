import {
  appendAuditLog,
  appendLocalOperation,
  appendSyncQueue,
  listSyncQueue,
  listRetryableQueueItems,
  markQueueItemState,
  runLocalTransaction,
} from "../db/repositories/syncRepo.js";
import { createInvoiceWithDependencies } from "../db/repositories/salesRepo.js";
import { withDbRetry } from "../db/prisma-retry.js";
import { resolveDesktopConflictInTransaction } from "./offline-conflict-service.js";

function nextRetryDate(attempts) {
  const backoffMinutes = Math.min(2 ** attempts, 30);
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

export async function createInvoiceTransaction(payload, actor = "system") {
  return withDbRetry(async () => runLocalTransaction(async (tx) => {
    const result = await createInvoiceWithDependencies(tx, payload);
    const allocationItems = result.allocations.map((allocation) => {
      const inventory = result.updatedInventories.find((item) => item.id === allocation.batchId);
      return {
        batch_id: allocation.batchId,
        sku: inventory?.sku ?? payload.inventorySku ?? null,
        qty: allocation.quantity,
        expires_on: inventory?.expiresOn ?? null
      };
    });

    await appendSyncQueue(tx, {
      entityType: "Invoice",
      entityId: result.invoice.id,
      operation: "UPSERT",
      payload: {
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        quantityDeducted: payload.quantity,
        allocations: allocationItems
      }
    });

    for (const updatedInventory of result.updatedInventories) {
      await appendSyncQueue(tx, {
        entityType: "InventoryItem",
        entityId: updatedInventory.id,
        operation: "UPSERT",
        payload: {
          inventoryId: updatedInventory.id,
          quantityOnHand: updatedInventory.quantityOnHand,
          sourceInvoiceId: result.invoice.id
        }
      });
    }

    await appendAuditLog(tx, {
      actor,
      action: "invoice.create.atomic",
      entityType: "Invoice",
      entityId: result.invoice.id,
      detailsJson: {
        invoiceNumber: result.invoice.invoiceNumber,
        inventorySku: payload.inventorySku,
        quantity: payload.quantity,
        splitCount: allocationItems.length,
        allocations: allocationItems
      }
    });

    await appendLocalOperation(tx, {
      operationId: `local-invoice-${result.invoice.id}`,
      entityType: "Invoice",
      entityId: result.invoice.id,
      operation: "CREATE",
      payload: {
        invoice_number: result.invoice.invoiceNumber,
        client_id: result.invoice.clientId,
        currency_code: result.invoice.currencyCode,
        payment_method: result.invoice.paymentMethod,
        status: result.invoice.status,
        issued_at: result.invoice.issuedAt,
        items: allocationItems
      },
      localRevision: result.invoice.localRevision
    });

    for (const updatedInventory of result.updatedInventories) {
      await appendLocalOperation(tx, {
        operationId: `local-inventory-${updatedInventory.id}-${updatedInventory.localRevision}`,
        entityType: "InventoryItem",
        entityId: updatedInventory.id,
        operation: "UPDATE",
        payload: {
          sku: updatedInventory.sku,
          name: updatedInventory.name,
          category: updatedInventory.category,
          quantity_on_hand: updatedInventory.quantityOnHand,
          reorder_level: updatedInventory.reorderLevel,
          unit_cost_minor: updatedInventory.unitCostMinor,
          sale_price_minor: updatedInventory.salePriceMinor,
          batch_number: updatedInventory.batchNumber,
          expires_on: updatedInventory.expiresOn
        },
        localRevision: updatedInventory.localRevision
      });
    }

    return result;
  }));
}

export async function runSyncRetryCycle() {
  const queueItems = await listRetryableQueueItems();

  for (const item of queueItems) {
    const payload = JSON.parse(item.payloadJson);

    if (payload.forceConflict) {
      await markQueueItemState(item.id, {
        status: "CONFLICT",
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        conflictReason: "Remote revision mismatch"
      });
      continue;
    }

    if (item.attempts >= 2) {
      await markQueueItemState(item.id, {
        status: "SYNCED",
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        conflictReason: null
      });
      continue;
    }

    await markQueueItemState(item.id, {
      status: "RETRY",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      nextRetryAt: nextRetryDate(item.attempts + 1),
      conflictReason: null
    });
  }

  return listSyncQueue();
}

export async function resolveConflict(queueId, resolution, actor = "system") {
  return runLocalTransaction(async (tx) => {
    const queueItem = await tx.syncQueue.update({
      where: { id: queueId },
      data: {
        status: "SYNCED",
        conflictReason: null,
        nextRetryAt: null,
        updatedAt: new Date()
      }
    });

    await appendAuditLog(tx, {
      actor,
      action: "sync.conflict.resolve",
      entityType: queueItem.entityType,
      entityId: queueItem.entityId,
      detailsJson: { resolution }
    });

    return queueItem;
  });
}

export async function resolveDesktopConflict(conflictId, payload = {}, actor = "system") {
  return runLocalTransaction(async (tx) => {
    return resolveDesktopConflictInTransaction(
      tx,
      conflictId,
      payload,
      actor,
      appendAuditLog,
      appendLocalOperation
    );
  });
}
