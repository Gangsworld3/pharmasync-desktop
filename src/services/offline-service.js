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

function nextRetryDate(attempts) {
  const backoffMinutes = Math.min(2 ** attempts, 30);
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

export async function createInvoiceTransaction(payload, actor = "system") {
  return runLocalTransaction(async (tx) => {
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
  });
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

function addMinutes(isoString, minutes) {
  return new Date(new Date(isoString).getTime() + minutes * 60 * 1000);
}

function resolveSuggestedDate(originalStart, suggestedStart) {
  if (suggestedStart && typeof suggestedStart === "object" && suggestedStart.starts_at) {
    return new Date(suggestedStart.starts_at);
  }

  if (typeof suggestedStart === "string" && suggestedStart.includes("T")) {
    return new Date(suggestedStart);
  }

  const base = new Date(originalStart);
  const [hours, minutes] = String(suggestedStart).split(":").map(Number);
  base.setHours(hours, minutes, 0, 0);
  return base;
}

export async function resolveDesktopConflict(conflictId, payload = {}, actor = "system") {
  return runLocalTransaction(async (tx) => {
    const conflict = await tx.localOperation.findUnique({ where: { id: conflictId } });

    if (!conflict || conflict.status !== "CONFLICT") {
      throw new Error("Conflict not found.");
    }

    const conflictPayload = conflict.conflictPayloadJson ? JSON.parse(conflict.conflictPayloadJson) : null;
    const operationPayload = conflict.payloadJson ? JSON.parse(conflict.payloadJson) : {};
    const action = payload.action ?? "DEFER";

    if (conflict.entityType === "Appointment" && action === "RESCHEDULE") {
      const suggestedStart = payload.suggestedStart;
      if (!suggestedStart) {
        throw new Error("Missing suggestedStart for reschedule action.");
      }

      const nextStartsAt = resolveSuggestedDate(operationPayload.starts_at, suggestedStart);
      const durationMinutes = Math.max(
        30,
        Math.round((new Date(operationPayload.ends_at).getTime() - new Date(operationPayload.starts_at).getTime()) / 60000) || 30
      );
      const nextEndsAt = addMinutes(nextStartsAt.toISOString(), durationMinutes);

      const appointment = await tx.appointment.update({
        where: { id: conflict.entityId },
        data: {
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          dirty: true,
          syncStatus: "PENDING",
          localRevision: { increment: 1 },
          lastModifiedLocally: new Date()
        }
      });

      await appendLocalOperation(tx, {
        operationId: `local-op-${appointment.id}-${appointment.localRevision}`,
        entityType: "Appointment",
        entityId: appointment.id,
        operation: "UPDATE",
        localRevision: appointment.localRevision,
        payload: {
          client_id: appointment.clientId,
          service_type: appointment.serviceType,
          staff_name: appointment.staffName,
          starts_at: appointment.startsAt,
          ends_at: appointment.endsAt,
          status: appointment.status,
          notes: appointment.notes
        }
      });

      await tx.localOperation.update({
        where: { id: conflictId },
        data: {
          status: "RESOLVED",
          errorDetail: `rescheduled:${suggestedStart}`,
          updatedAt: new Date()
        }
      });

      await appendAuditLog(tx, {
        actor,
          action: "desktop.conflict.reschedule",
          entityType: "Appointment",
          entityId: appointment.id,
          detailsJson: {
          suggestedStart: nextStartsAt.toISOString(),
          previousConflict: conflictPayload?.type ?? "CONFLICT"
        }
      });

      return { status: "resolved", action: "RESCHEDULE", appointmentId: appointment.id, startsAt: nextStartsAt.toISOString() };
    }

    if (action === "RETRY") {
      await tx.localOperation.update({
        where: { id: conflictId },
        data: {
          status: "RETRY_SCHEDULED",
          conflictPayloadJson: null,
          errorDetail: "retry_requested",
          nextAttemptAt: new Date(),
          backoffMs: 0,
          updatedAt: new Date()
        }
      });

      await appendAuditLog(tx, {
        actor,
        action: "desktop.conflict.retry",
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        detailsJson: { conflictType: conflictPayload?.type ?? "CONFLICT" }
      });

      return { status: "queued", action, entityId: conflict.entityId };
    }

    if (action === "DEFER") {
      await tx.localOperation.update({
        where: { id: conflictId },
        data: {
          status: "CONFLICT",
          errorDetail: "deferred_by_user",
          updatedAt: new Date()
        }
      });

      await appendAuditLog(tx, {
        actor,
        action: "desktop.conflict.defer",
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        detailsJson: { conflictType: conflictPayload?.type ?? "CONFLICT" }
      });

      return { status: "deferred", action, entityId: conflict.entityId };
    }

    await tx.localOperation.update({
      where: { id: conflictId },
      data: {
        status: "RESOLVED",
        errorDetail: action.toLowerCase(),
        updatedAt: new Date()
      }
    });

    await appendAuditLog(tx, {
      actor,
      action: "desktop.conflict.resolve",
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      detailsJson: { action, conflictType: conflictPayload?.type ?? "CONFLICT" }
    });

    return { status: "resolved", action, entityId: conflict.entityId };
  });
}
