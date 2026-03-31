export {
  resolveDesktopConflict,
  resolveConflict,
  runSyncRetryCycle
} from "./offline-service.js";

export {
  authenticateDesktopSession,
  getCurrentRemoteUser,
  getRemoteDailySales,
  getRemoteExpiryLoss,
  getRemoteTopMedicines,
  getSyncEngineStatus,
  logoutDesktopSession,
  recordLocalOperation,
  runSyncCycle,
  startBackgroundSyncLoop
} from "./sync-engine.js";

export { listLocalClients, createClient, updateClient } from "./client-service.js";
export {
  listInventoryBatches,
  createInventoryBatch,
  updateInventoryBatch,
  adjustInventoryBatch
} from "./inventory-service.js";
export { listLocalInvoices, createInvoice } from "./sales-service.js";
export { listLocalAppointments, createAppointment } from "./appointment-service.js";
export {
  exportLocalDatabase,
  getDesktopSettings,
  getRuntimePaths,
  saveDesktopSettings
} from "./desktop-runtime.js";
