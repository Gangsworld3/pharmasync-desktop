import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  appName: "PharmaSync Desktop",
  getSyncStatus: () => ipcRenderer.invoke("sync:getStatus"),
  runSync: () => ipcRenderer.invoke("sync:run"),
  getSummary: () => ipcRenderer.invoke("summary:get"),
  listClients: () => ipcRenderer.invoke("clients:list"),
  listInventory: () => ipcRenderer.invoke("inventory:list"),
  listAppointments: () => ipcRenderer.invoke("appointments:list"),
  createInvoice: (payload) => ipcRenderer.invoke("invoices:create", payload),
  createAppointment: (payload) => ipcRenderer.invoke("appointments:create", payload)
});
