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

export async function callIpc(channel, payload = {}) {
  if (!window.api?.invoke) {
    throw new Error("IPC bridge is not available.");
  }

  const response = await window.api.invoke(channel, payload);

  if (!response || typeof response !== "object") {
    throw new Error("Invalid IPC response");
  }

  if (response.success === false) {
    throw new Error(response.error?.message || "IPC error");
  }

  return response.data;
}
