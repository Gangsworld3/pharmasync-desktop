import { prisma } from "./client.js";
export {
  appendLocalOperation,
  appendAuditLog,
  appendSyncQueue,
  ensureDeviceState,
  getConflictLocalOperations,
  getDeviceState,
  getPendingLocalOperations,
  listAuditLogs,
  listConflictOperations,
  listLocalOperations,
  listSyncQueue,
  listRetryableQueueItems,
  markQueueItemState,
  recoverInProgressLocalOperations,
  runLocalTransaction,
  updateDeviceState,
  updateLocalOperation
} from "./repositories/syncRepo.js";
export { createLocalClient, listClients, updateLocalClient } from "./repositories/clientRepo.js";
export {
  adjustLocalInventoryBatch,
  createLocalInventoryBatch,
  listInventory,
  updateLocalInventoryBatch
} from "./repositories/inventoryRepo.js";
export { createLocalAppointment, listAppointments } from "./repositories/appointmentRepo.js";
export { createInvoiceWithDependencies, listInvoices } from "./repositories/salesRepo.js";

const activeOnly = { deletedAt: null };
export async function getOfflineSummary() {
  const [clients, invoices, inventory, appointments, messages, queueDepth, conflicts, pendingOperations, deviceState] = await Promise.all([
    prisma.client.count({ where: activeOnly }),
    prisma.invoice.count({ where: activeOnly }),
    prisma.inventoryItem.count({ where: activeOnly }),
    prisma.appointment.count({ where: activeOnly }),
    prisma.message.count({ where: activeOnly }),
    prisma.syncQueue.count({ where: { status: { in: ["PENDING", "RETRY"] } } }),
    prisma.syncQueue.count({ where: { status: "CONFLICT" } }),
    prisma.localOperation.count({ where: { status: { in: ["PENDING", "RETRY", "RETRY_SCHEDULED", "IN_PROGRESS", "CONFLICT"] } } }),
    prisma.deviceState.findFirst({ orderBy: { updatedAt: "desc" } })
  ]);

  return {
    clients,
    invoices,
    inventory,
    appointments,
    messages,
    queueDepth,
    conflicts,
    pendingOperations,
    deviceState
  };
}

export function listMessages() {
  return prisma.message.findMany({
    where: activeOnly,
    include: { client: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function upsertClientFromServer(change) {
  const data = change.data?.data ?? change.data;
  const existing = await prisma.client.findUnique({ where: { id: change.entityId } });
  const base = {
    clientCode: data.client_code ?? existing?.clientCode ?? `client-${change.entityId}`,
    fullName: data.full_name ?? existing?.fullName ?? "Unknown client",
    phone: data.phone ?? existing?.phone ?? null,
    email: data.email ?? existing?.email ?? null,
    preferredLanguage: data.preferred_language ?? existing?.preferredLanguage ?? "en",
    city: data.city ?? existing?.city ?? null,
    notes: data.notes ?? existing?.notes ?? null,
    dirty: false,
    syncStatus: "SYNCED",
    serverRevision: change.serverRevision,
    lastSyncedAt: new Date(),
    lastModifiedLocally: new Date()
  };

  if (change.operation === "DELETE") {
    return prisma.client.upsert({
      where: { id: change.entityId },
      update: { deletedAt: new Date(data.deleted_at), dirty: false, syncStatus: "SYNCED", serverRevision: change.serverRevision, lastSyncedAt: new Date() },
      create: {
        id: change.entityId,
        clientCode: data.client_code ?? `deleted-${change.entityId}`,
        fullName: data.full_name ?? "Deleted client",
        preferredLanguage: data.preferred_language ?? "en",
        dirty: false,
        syncStatus: "SYNCED",
        serverRevision: change.serverRevision,
        lastSyncedAt: new Date(),
        lastModifiedLocally: new Date(),
        deletedAt: new Date(data.deleted_at)
      }
    });
  }

  return prisma.client.upsert({
    where: { id: change.entityId },
    update: { ...base, deletedAt: null },
    create: { id: change.entityId, ...base }
  });
}

export async function upsertInventoryFromServer(change) {
  const data = change.data;
  const existing = await prisma.inventoryItem.findUnique({ where: { id: change.entityId } });

  if (change.operation === "DELETE") {
    return prisma.inventoryItem.upsert({
      where: { id: change.entityId },
      update: { deletedAt: new Date(data.deleted_at), dirty: false, syncStatus: "SYNCED", serverRevision: change.serverRevision, lastSyncedAt: new Date() },
      create: {
        id: change.entityId,
        sku: data.sku ?? `deleted-${change.entityId}`,
        name: data.name ?? "Deleted inventory item",
        category: data.category ?? "Unknown",
        dirty: false,
        syncStatus: "SYNCED",
        serverRevision: change.serverRevision,
        lastSyncedAt: new Date(),
        lastModifiedLocally: new Date(),
        deletedAt: new Date(data.deleted_at)
      }
    });
  }

  return prisma.inventoryItem.upsert({
    where: { id: change.entityId },
    update: {
      sku: data.sku ?? existing?.sku ?? `inventory-${change.entityId}`,
      name: data.name ?? existing?.name ?? "Unknown inventory item",
      category: data.category ?? existing?.category ?? "Unknown",
      quantityOnHand: Number(data.quantity_on_hand ?? existing?.quantityOnHand ?? 0),
      reorderLevel: Number(data.reorder_level ?? existing?.reorderLevel ?? 0),
      unitCostMinor: data.unit_cost_minor ?? existing?.unitCostMinor ?? 0,
      salePriceMinor: data.sale_price_minor ?? existing?.salePriceMinor ?? 0,
      batchNumber: data.batch_number ?? existing?.batchNumber ?? null,
      expiresOn: data.expires_on ? new Date(data.expires_on) : existing?.expiresOn ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date(),
      deletedAt: null
    },
    create: {
      id: change.entityId,
      sku: data.sku ?? existing?.sku ?? `inventory-${change.entityId}`,
      name: data.name ?? existing?.name ?? "Unknown inventory item",
      category: data.category ?? existing?.category ?? "Unknown",
      quantityOnHand: Number(data.quantity_on_hand ?? existing?.quantityOnHand ?? 0),
      reorderLevel: Number(data.reorder_level ?? existing?.reorderLevel ?? 0),
      unitCostMinor: data.unit_cost_minor ?? existing?.unitCostMinor ?? 0,
      salePriceMinor: data.sale_price_minor ?? existing?.salePriceMinor ?? 0,
      batchNumber: data.batch_number ?? existing?.batchNumber ?? null,
      expiresOn: data.expires_on ? new Date(data.expires_on) : existing?.expiresOn ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date()
    }
  });
}

export async function upsertAppointmentFromServer(change) {
  const data = change.data;
  const existing = await prisma.appointment.findUnique({ where: { id: change.entityId } });

  if (change.operation === "DELETE") {
    return prisma.appointment.upsert({
      where: { id: change.entityId },
      update: { deletedAt: new Date(data.deleted_at), dirty: false, syncStatus: "SYNCED", serverRevision: change.serverRevision, lastSyncedAt: new Date() },
      create: {
        id: change.entityId,
        clientId: data.client_id ?? "missing-client",
        serviceType: data.service_type ?? "Deleted appointment",
        startsAt: new Date(),
        endsAt: new Date(),
        dirty: false,
        syncStatus: "SYNCED",
        serverRevision: change.serverRevision,
        lastSyncedAt: new Date(),
        lastModifiedLocally: new Date(),
        deletedAt: new Date(data.deleted_at)
      }
    });
  }

  return prisma.appointment.upsert({
    where: { id: change.entityId },
    update: {
      clientId: data.client_id ?? existing?.clientId ?? null,
      serviceType: data.service_type ?? existing?.serviceType ?? "Appointment",
      staffName: data.staff_name ?? existing?.staffName ?? null,
      startsAt: data.starts_at ? new Date(data.starts_at) : existing?.startsAt ?? new Date(),
      endsAt: data.ends_at ? new Date(data.ends_at) : existing?.endsAt ?? new Date(),
      status: data.status ?? existing?.status ?? "PENDING",
      reminderSentAt: data.reminder_sent_at ? new Date(data.reminder_sent_at) : existing?.reminderSentAt ?? null,
      notes: data.notes ?? existing?.notes ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date(),
      deletedAt: null
    },
    create: {
      id: change.entityId,
      clientId: data.client_id ?? existing?.clientId ?? null,
      serviceType: data.service_type ?? existing?.serviceType ?? "Appointment",
      staffName: data.staff_name ?? existing?.staffName ?? null,
      startsAt: data.starts_at ? new Date(data.starts_at) : existing?.startsAt ?? new Date(),
      endsAt: data.ends_at ? new Date(data.ends_at) : existing?.endsAt ?? new Date(),
      status: data.status ?? existing?.status ?? "PENDING",
      reminderSentAt: data.reminder_sent_at ? new Date(data.reminder_sent_at) : existing?.reminderSentAt ?? null,
      notes: data.notes ?? existing?.notes ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date()
    }
  });
}

export async function upsertInvoiceFromServer(change) {
  const data = change.data;
  const existing = await prisma.invoice.findUnique({ where: { id: change.entityId } });

  if (change.operation === "DELETE") {
    return prisma.invoice.upsert({
      where: { id: change.entityId },
      update: { deletedAt: new Date(data.deleted_at), dirty: false, syncStatus: "SYNCED", serverRevision: change.serverRevision, lastSyncedAt: new Date() },
      create: {
        id: change.entityId,
        invoiceNumber: data.invoice_number ?? `deleted-${change.entityId}`,
        totalMinor: data.total_minor ?? 0,
        balanceDueMinor: data.balance_due_minor ?? 0,
        paymentMethod: data.payment_method ?? "unknown",
        dirty: false,
        syncStatus: "SYNCED",
        serverRevision: change.serverRevision,
        lastSyncedAt: new Date(),
        lastModifiedLocally: new Date(),
        deletedAt: new Date(data.deleted_at)
      }
    });
  }

  return prisma.invoice.upsert({
    where: { id: change.entityId },
    update: {
      invoiceNumber: data.invoice_number ?? existing?.invoiceNumber ?? `invoice-${change.entityId}`,
      clientId: data.client_id ?? existing?.clientId ?? null,
      currencyCode: data.currency_code ?? existing?.currencyCode ?? "SSP",
      totalMinor: data.total_minor ?? existing?.totalMinor ?? 0,
      balanceDueMinor: data.balance_due_minor ?? existing?.balanceDueMinor ?? 0,
      paymentMethod: data.payment_method ?? existing?.paymentMethod ?? "unknown",
      status: data.status ?? existing?.status ?? "ISSUED",
      issuedAt: data.issued_at ? new Date(data.issued_at) : existing?.issuedAt ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date(),
      deletedAt: null
    },
    create: {
      id: change.entityId,
      invoiceNumber: data.invoice_number ?? existing?.invoiceNumber ?? `invoice-${change.entityId}`,
      clientId: data.client_id ?? existing?.clientId ?? null,
      currencyCode: data.currency_code ?? existing?.currencyCode ?? "SSP",
      totalMinor: data.total_minor ?? existing?.totalMinor ?? 0,
      balanceDueMinor: data.balance_due_minor ?? existing?.balanceDueMinor ?? 0,
      paymentMethod: data.payment_method ?? existing?.paymentMethod ?? "unknown",
      status: data.status ?? existing?.status ?? "ISSUED",
      issuedAt: data.issued_at ? new Date(data.issued_at) : existing?.issuedAt ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date()
    }
  });
}

export async function appendMessageFromServer(change) {
  const data = change.data;
  return prisma.message.upsert({
    where: { id: change.entityId },
    update: {
      conversationId: data.conversation_id ?? null,
      senderId: data.sender_id ?? null,
      body: data.content,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date(),
      sentAt: data.created_at ? new Date(data.created_at) : new Date()
    },
    create: {
      id: change.entityId,
      clientId: null,
      channel: "IN_APP",
      direction: "event",
      recipient: null,
      body: data.content,
      deliveryStatus: "synced",
      sentAt: data.created_at ? new Date(data.created_at) : new Date(),
      conversationId: data.conversation_id ?? null,
      senderId: data.sender_id ?? null,
      dirty: false,
      syncStatus: "SYNCED",
      serverRevision: change.serverRevision,
      lastSyncedAt: new Date(),
      lastModifiedLocally: new Date()
    }
  });
}



