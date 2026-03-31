import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../client.js";

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
      deviceId: process.env.PHARMASYNC_DEVICE_ID ?? `desktop-${randomUUID()}`
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

export function listSyncQueue() {
  return prisma.syncQueue.findMany({ orderBy: { createdAt: "desc" } });
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
      await wait(baseDelayMs * attempt);
    }
  }

  throw new Error("Unexpected transaction retry flow state.");
}
