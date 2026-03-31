import { prisma } from "../client.js";

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
