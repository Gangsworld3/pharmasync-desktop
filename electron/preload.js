import { contextBridge, ipcRenderer } from "electron";
import { createRendererApi } from "./ipc-channels.js";

async function invokeWithContract(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || typeof response !== "object" || !("success" in response)) {
    throw new Error("Invalid IPC contract");
  }
  return response;
}

contextBridge.exposeInMainWorld("api", {
  ...createRendererApi(invokeWithContract),
  invoke: invokeWithContract
});
