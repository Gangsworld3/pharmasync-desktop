import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let mainWindow = null;
const uiMode = process.env.PHARMASYNC_UI_MODE === "react" ? "react" : "legacy";

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

  const entryPath = uiMode === "react" ? "/react-shell.html" : "/";
  await mainWindow.loadURL(`http://127.0.0.1:4173${entryPath}`);
}

app.whenReady().then(createWindow);

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
