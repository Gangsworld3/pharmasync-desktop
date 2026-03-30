export const IPC_CHANNELS = Object.freeze({
  AUTH_GET_CURRENT_USER: "auth:getCurrentUser",
  SYNC_STATUS: "sync:getStatus",
  SYNC_RUN: "sync:run",
  SUMMARY_GET: "summary:get",
  ANALYTICS_DAILY_SALES: "analytics:getDailySales",
  ANALYTICS_TOP_MEDICINES: "analytics:getTopMedicines",
  ANALYTICS_EXPIRY_LOSS: "analytics:getExpiryLoss",
  CLIENTS_LIST: "clients:list",
  INVENTORY_LIST: "inventory:list",
  INVENTORY_CREATE: "inventory:create",
  INVENTORY_UPDATE: "inventory:update",
  INVENTORY_ADJUST: "inventory:adjust",
  APPOINTMENTS_LIST: "appointments:list",
  APPOINTMENTS_CREATE: "appointments:create",
  INVOICES_CREATE: "invoices:create",
  RECEIPT_PRINT: "receipt:print"
});

export function createRendererApi(invoke) {
  return {
    appName: "PharmaSync Desktop",
    getCurrentUser: () => invoke(IPC_CHANNELS.AUTH_GET_CURRENT_USER),
    getSyncStatus: () => invoke(IPC_CHANNELS.SYNC_STATUS),
    runSync: () => invoke(IPC_CHANNELS.SYNC_RUN),
    getSummary: () => invoke(IPC_CHANNELS.SUMMARY_GET),
    getDailySalesAnalytics: (params) => invoke(IPC_CHANNELS.ANALYTICS_DAILY_SALES, params),
    getTopMedicinesAnalytics: (params) => invoke(IPC_CHANNELS.ANALYTICS_TOP_MEDICINES, params),
    getExpiryLossAnalytics: (params) => invoke(IPC_CHANNELS.ANALYTICS_EXPIRY_LOSS, params),
    listClients: () => invoke(IPC_CHANNELS.CLIENTS_LIST),
    listInventory: () => invoke(IPC_CHANNELS.INVENTORY_LIST),
    createInventoryBatch: (payload) => invoke(IPC_CHANNELS.INVENTORY_CREATE, payload),
    updateInventoryBatch: (batchId, payload) => invoke(IPC_CHANNELS.INVENTORY_UPDATE, { batchId, payload }),
    adjustInventoryBatch: (batchId, delta, reason) => invoke(IPC_CHANNELS.INVENTORY_ADJUST, { batchId, delta, reason }),
    listAppointments: () => invoke(IPC_CHANNELS.APPOINTMENTS_LIST),
    createInvoice: (payload) => invoke(IPC_CHANNELS.INVOICES_CREATE, payload),
    createAppointment: (payload) => invoke(IPC_CHANNELS.APPOINTMENTS_CREATE, payload),
    printReceipt: (payload) => invoke(IPC_CHANNELS.RECEIPT_PRINT, payload)
  };
}
