import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let mainWindow = null;
const uiMode = process.env.PHARMASYNC_UI_MODE === "react" ? "react" : "legacy";
const reactDevUrl = process.env.PHARMASYNC_REACT_DEV_URL || "http://127.0.0.1:5173";
const localApiBase = "http://127.0.0.1:4173";

const routeMap = Object.freeze({
  "sync:getStatus": { method: "GET", path: "/api/local/sync/status" },
  "sync:run": { method: "POST", path: "/api/local/sync/run" },
  "summary:get": { method: "GET", path: "/api/local/summary" },
  "clients:list": { method: "GET", path: "/api/local/clients" },
  "inventory:list": { method: "GET", path: "/api/local/inventory" },
  "appointments:list": { method: "GET", path: "/api/local/appointments" },
  "invoices:create": { method: "POST", path: "/api/local/invoices" },
  "appointments:create": { method: "POST", path: "/api/local/appointments" }
});

async function invokeLocalApi(channel, payload = null) {
  const route = routeMap[channel];
  if (!route) {
    throw new Error(`Unsupported IPC channel: ${channel}`);
  }

  const response = await fetch(`${localApiBase}${route.path}`, {
    method: route.method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = data?.detail || data?.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data;
}

function registerIpcHandlers() {
  for (const channel of Object.keys(routeMap)) {
    ipcMain.handle(channel, async (_event, payload) => invokeLocalApi(channel, payload));
  }
}

async function bootDesktopServer() {
  process.env.PORT = process.env.PORT || "4173";
  process.env.PHARMASYNC_DATA_DIR = process.env.PHARMASYNC_DATA_DIR || app.getPath("userData");
  await import(pathToFileURL(join(app.getAppPath(), "server.js")).href);
}

async function createWindow() {
  await bootDesktopServer();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#121416",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: join(app.getAppPath(), "electron", "preload.js")
    }
  });

  if (uiMode === "react") {
    try {
      await mainWindow.loadURL(reactDevUrl);
      return;
    } catch {
      await mainWindow.loadURL(`${localApiBase}/react-shell.html`);
      return;
    }
  }

  await mainWindow.loadURL(`${localApiBase}/`);
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
