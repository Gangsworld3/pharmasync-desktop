import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("api", {
  appName: "PharmaSync Desktop"
});
