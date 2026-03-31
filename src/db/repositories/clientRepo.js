import { randomUUID } from "node:crypto";
import { prisma } from "../client.js";
import { appendLocalOperation } from "./syncRepo.js";

const activeOnly = { deletedAt: null };

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
