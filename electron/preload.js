import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  appName: "PharmaSync Desktop",
  getSyncStatus: () => ipcRenderer.invoke("sync:getStatus"),
  runSync: () => ipcRenderer.invoke("sync:run"),
  getSummary: () => ipcRenderer.invoke("summary:get"),
  listClients: () => ipcRenderer.invoke("clients:list"),
  listInventory: () => ipcRenderer.invoke("inventory:list"),
  createInventoryBatch: (payload) => ipcRenderer.invoke("inventory:create", payload),
  updateInventoryBatch: (batchId, payload) => ipcRenderer.invoke("inventory:update", { batchId, payload }),
  adjustInventoryBatch: (batchId, delta, reason) => ipcRenderer.invoke("inventory:adjust", { batchId, delta, reason }),
  listAppointments: () => ipcRenderer.invoke("appointments:list"),
  createInvoice: (payload) => ipcRenderer.invoke("invoices:create", payload),
  createAppointment: (payload) => ipcRenderer.invoke("appointments:create", payload),
  printReceipt: (payload) => ipcRenderer.invoke("receipt:print", payload)
});
