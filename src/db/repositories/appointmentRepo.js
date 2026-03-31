import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { prisma } from "../client.js";
import { getDatabasePath } from "../../services/desktop-runtime.js";
import { appendLocalOperation } from "./syncRepo.js";

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
