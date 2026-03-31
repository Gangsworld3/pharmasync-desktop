import { prisma } from "./client.js";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { getDatabasePath } from "../services/desktop-runtime.js";
import { appendLocalOperation } from "./repositories/syncRepo.js";

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
  listRetryableQueueItems,
  markQueueItemState,
  recoverInProgressLocalOperations,
  updateDeviceState,
  updateLocalOperation
} from "./repositories/syncRepo.js";
export { createLocalClient, listClients, updateLocalClient } from "./repositories/clientRepo.js";
export { createInvoiceWithDependencies, listInvoices } from "./repositories/salesRepo.js";

const activeOnly = { deletedAt: null };
const sqliteReader = new Database(getDatabasePath(), { readonly: true });

function normalizeSqliteDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  return new Date(value);
}

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

export function listInventory() {
  return prisma.inventoryItem.findMany({
    where: activeOnly,
    orderBy: [{ name: "asc" }, { expiresOn: "asc" }, { batchNumber: "asc" }]
  });
}

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

export function listAppointments() {
  return prisma.$transaction(async (tx) => {
    const rows = sqliteReader.prepare(`
      SELECT id, clientId, serviceType, staffName, startsAt, endsAt, status, reminderSentAt, notes, dirty, syncStatus, localRevision, serverRevision, lastSyncedAt, lastModifiedLocally, createdAt, updatedAt, deletedAt
      FROM Appointment
      WHERE deletedAt IS NULL
      ORDER BY startsAt ASC
    `).all();

    const clientIds = [...new Set(rows.map((row) => row.clientId).filter(Boolean))];
    const clients = clientIds.length ? await tx.client.findMany({ where: { id: { in: clientIds } } }) : [];
    const clientMap = new Map(clients.map((client) => [client.id, client]));

    return rows.map((row) => ({
      ...row,
      startsAt: normalizeSqliteDate(row.startsAt),
      endsAt: normalizeSqliteDate(row.endsAt),
      reminderSentAt: normalizeSqliteDate(row.reminderSentAt),
      lastSyncedAt: normalizeSqliteDate(row.lastSyncedAt),
      lastModifiedLocally: normalizeSqliteDate(row.lastModifiedLocally),
      createdAt: normalizeSqliteDate(row.createdAt),
      updatedAt: normalizeSqliteDate(row.updatedAt),
      deletedAt: normalizeSqliteDate(row.deletedAt),
      client: clientMap.get(row.clientId) ?? null
    }));
  });
}

export async function createLocalAppointment(payload) {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        id: payload.id ?? `appt-${randomUUID()}`,
        clientId: payload.clientId,
        serviceType: payload.serviceType ?? payload.service_type ?? "Consultation",
        staffName: payload.staffName ?? payload.staff_name ?? null,
        startsAt: new Date(payload.startsAt ?? payload.starts_at),
        endsAt: new Date(payload.endsAt ?? payload.ends_at),
        status: payload.status ?? "PENDING",
        notes: payload.notes ?? null,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: 1,
        serverRevision: 0,
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId: payload.operationId ?? `local-op-${randomUUID()}`,
      entityType: "Appointment",
      entityId: appointment.id,
      operation: "CREATE",
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

    return appointment;
  });
}

export function listMessages() {
  return prisma.message.findMany({
    where: activeOnly,
    include: { client: true },
    orderBy: { createdAt: "desc" }
  });
}

export function listSyncQueue() {
  return prisma.syncQueue.findMany({ orderBy: { createdAt: "desc" } });
}

function isSqliteLockedError(error) {
  const message = String(error?.message ?? "");
  return message.toLowerCase().includes("database is locked");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSqliteLockRetry(work, { maxAttempts = 4, baseDelayMs = 20 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isSqliteLockedError(error) || attempt === maxAttempts) {
        throw error;
      }
      await wait(baseDelayMs * attempt);
    }
  }
  throw new Error("Unexpected sqlite retry flow state.");
}

export async function runLocalTransaction(callback) {
  const maxAttempts = Number(process.env.PHARMASYNC_SQLITE_TX_MAX_ATTEMPTS ?? 4);
  const baseDelayMs = Number(process.env.PHARMASYNC_SQLITE_TX_RETRY_BASE_MS ?? 20);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback);
    } catch (error) {
      if (!isSqliteLockedError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = baseDelayMs * attempt;
      await wait(delayMs);
    }
  }

  throw new Error("Unexpected transaction retry flow state.");
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



