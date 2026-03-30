import { contextBridge, ipcRenderer } from "electron";
import { createRendererApi } from "./ipc-channels.js";

contextBridge.exposeInMainWorld("api", createRendererApi((channel, payload) => ipcRenderer.invoke(channel, payload)));
