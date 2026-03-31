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
export {
  appendMessageFromServer,
  upsertAppointmentFromServer,
  upsertClientFromServer,
  upsertInventoryFromServer,
  upsertInvoiceFromServer
} from "./repositories/syncApplyRepo.js";

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



