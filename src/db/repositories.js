import { prisma } from "./client.js";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { getDatabasePath } from "../services/desktop-runtime.js";

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

function buildClientPayloadWithCrdt({
  client,
  changedFields = []
}) {
  const payload = {
    id: client.id,
    client_code: client.clientCode,
    full_name: client.fullName,
    phone: client.phone,
    email: client.email,
    preferred_language: client.preferredLanguage,
    city: client.city,
    notes: client.notes
  };

  const clocks = Object.fromEntries(
    changedFields.map((field) => [field, client.localRevision])
  );
  payload._crdt = {
    changedFields,
    fieldClocks: clocks
  };
  return payload;
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

export function listClients() {
  return prisma.client.findMany({ where: activeOnly, orderBy: { updatedAt: "desc" } });
}

export async function createLocalClient(payload) {
  const operationId = payload.operationId ?? `local-op-${randomUUID()}`;
  const clientId = payload.id ?? `client-${randomUUID()}`;

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        id: clientId,
        clientCode: payload.clientCode ?? payload.client_code ?? `CLI-${Date.now()}`,
        fullName: payload.fullName ?? payload.full_name ?? "New client",
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        preferredLanguage: payload.preferredLanguage ?? payload.preferred_language ?? "en",
        city: payload.city ?? "Juba",
        notes: payload.notes ?? null,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: 1,
        serverRevision: 0,
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId,
      entityType: "Client",
      entityId: client.id,
      operation: "CREATE",
      localRevision: 1,
      payload: buildClientPayloadWithCrdt({
        client,
        changedFields: ["client_code", "full_name", "phone", "email", "preferred_language", "city", "notes"]
      })
    });

    return client;
  });
}

export async function updateLocalClient(id, payload) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findUnique({ where: { id } });

    if (!existing || existing.deletedAt) {
      throw new Error("Client not found.");
    }

    const client = await tx.client.update({
      where: { id },
      data: {
        clientCode: payload.clientCode ?? payload.client_code ?? existing.clientCode,
        fullName: payload.fullName ?? payload.full_name ?? existing.fullName,
        phone: payload.phone ?? existing.phone,
        email: payload.email ?? existing.email,
        preferredLanguage: payload.preferredLanguage ?? payload.preferred_language ?? existing.preferredLanguage,
        city: payload.city ?? existing.city,
        notes: payload.notes ?? existing.notes,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: { increment: 1 },
        lastModifiedLocally: new Date()
      }
    });

    const fieldMap = [
      ["client_code", payload.clientCode ?? payload.client_code, existing.clientCode],
      ["full_name", payload.fullName ?? payload.full_name, existing.fullName],
      ["phone", payload.phone, existing.phone],
      ["email", payload.email, existing.email],
      ["preferred_language", payload.preferredLanguage ?? payload.preferred_language, existing.preferredLanguage],
      ["city", payload.city, existing.city],
      ["notes", payload.notes, existing.notes]
    ];
    const changedFields = fieldMap
      .filter(([, incoming, previous]) => incoming !== undefined && incoming !== previous)
      .map(([field]) => field);

    await appendLocalOperation(tx, {
      operationId: payload.operationId ?? `local-op-${randomUUID()}`,
      entityType: "Client",
      entityId: client.id,
      operation: "UPDATE",
      localRevision: client.localRevision,
      payload: buildClientPayloadWithCrdt({
        client,
        changedFields: changedFields.length ? changedFields : ["notes"]
      })
    });

    return client;
  });
}

export function listInvoices() {
  return prisma.invoice.findMany({
    where: activeOnly,
    include: { client: true },
    orderBy: { createdAt: "desc" }
  });
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

export function listAuditLogs() {
  return prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
}

export function getDeviceState() {
  return prisma.deviceState.findFirst({ orderBy: { updatedAt: "desc" } });
}

export function listLocalOperations(statuses = ["PENDING", "RETRY", "RETRY_SCHEDULED", "IN_PROGRESS", "CONFLICT"]) {
  return prisma.localOperation.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
}

export function listConflictOperations() {
  return prisma.localOperation.findMany({
    where: { status: "CONFLICT" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
  });
}

export async function ensureDeviceState() {
  const existing = await getDeviceState();
  if (existing) {
    return existing;
  }

  return prisma.deviceState.create({
    data: {
      deviceId: process.env.PHARMASYNC_DEVICE_ID ?? `desktop-${crypto.randomUUID()}`
    }
  });
}

export function updateDeviceState(data) {
  return prisma.deviceState.update({
    where: { deviceId: data.deviceId },
    data
  });
}

export function appendLocalOperation(entryOrTx, maybeEntry) {
  const tx = maybeEntry ? entryOrTx : prisma;
  const entry = maybeEntry ?? entryOrTx;
  const idempotencyKey = entry.idempotencyKey
    ?? createHash("sha256")
      .update(`${entry.operationId}|${entry.entityType}|${entry.entityId}|${entry.operation}`)
      .digest("hex");

  return tx.localOperation.create({
    data: {
      operationId: entry.operationId,
      idempotencyKey,
      entityType: entry.entityType,
      entityId: entry.entityId,
      operation: entry.operation,
      payloadJson: JSON.stringify(entry.payload),
      localRevision: entry.localRevision,
      status: entry.status ?? "PENDING",
      conflictPayloadJson: entry.conflictPayloadJson ? JSON.stringify(entry.conflictPayloadJson) : null,
      errorDetail: entry.errorDetail ?? null,
      backoffMs: entry.backoffMs ?? 0,
      nextAttemptAt: entry.nextAttemptAt ?? null,
      deadLetteredAt: entry.deadLetteredAt ?? null
    }
  });
}

export async function updateLocalOperation(id, data) {
  const normalizedData = {
    ...data,
    conflictPayloadJson: data.conflictPayloadJson ? JSON.stringify(data.conflictPayloadJson) : data.conflictPayloadJson,
    updatedAt: new Date()
  };

  const updated = await withSqliteLockRetry(() => prisma.localOperation.updateMany({
    where: { id },
    data: normalizedData
  }));

  // Retry/chaos flows can race with operation cleanup; treat missing rows as no-op.
  if (updated.count === 0) {
    return null;
  }

  return prisma.localOperation.findUnique({ where: { id } });
}

export async function getPendingLocalOperations() {
  return prisma.localOperation.findMany({
    where: { status: { in: ["PENDING", "RETRY_SCHEDULED", "IN_PROGRESS", "RETRY"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
}

export async function recoverInProgressLocalOperations(now = new Date()) {
  const updated = await prisma.localOperation.updateMany({
    where: { status: "IN_PROGRESS" },
    data: {
      status: "RETRY_SCHEDULED",
      nextAttemptAt: now,
      errorDetail: "Recovered from interrupted sync cycle",
      updatedAt: now
    }
  });

  return updated.count;
}

export async function getConflictLocalOperations() {
  return prisma.localOperation.findMany({
    where: { status: "CONFLICT" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
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

export function appendSyncQueue(tx, event) {
  return tx.syncQueue.create({
    data: {
      entityType: event.entityType,
      entityId: event.entityId,
      operation: event.operation,
      payloadJson: JSON.stringify(event.payload),
      status: event.status ?? "PENDING",
      attempts: event.attempts ?? 0,
      nextRetryAt: event.nextRetryAt ?? new Date()
    }
  });
}

export function appendAuditLog(tx, entry) {
  return tx.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      detailsJson: entry.detailsJson ? JSON.stringify(entry.detailsJson) : null
    }
  });
}

export function listRetryableQueueItems(now = new Date()) {
  return prisma.syncQueue.findMany({
    where: {
      status: { in: ["PENDING", "RETRY"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
}

export function markQueueItemState(id, data) {
  return prisma.syncQueue.update({ where: { id }, data });
}

