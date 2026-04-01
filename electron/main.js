import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "./ipc-channels.js";

let mainWindow = null;
const uiMode = process.env.PHARMASYNC_UI_MODE === "legacy" ? "legacy" : "react";
const reactDevUrl = process.env.PHARMASYNC_REACT_DEV_URL || "http://127.0.0.1:5173";
const localApiBase = "http://127.0.0.1:4173";
let syncEngineModulePromise = null;
let summaryRepoModulePromise = null;
let clientServiceModulePromise = null;
let inventoryServiceModulePromise = null;
let appointmentServiceModulePromise = null;
let salesServiceModulePromise = null;

function loadSyncEngineModule() {
  if (!syncEngineModulePromise) {
    syncEngineModulePromise = import("../src/services/sync-engine.js");
  }
  return syncEngineModulePromise;
}

function loadSummaryRepoModule() {
  if (!summaryRepoModulePromise) {
    summaryRepoModulePromise = import("../src/db/repositories/summaryRepo.js");
  }
  return summaryRepoModulePromise;
}

function loadClientServiceModule() {
  if (!clientServiceModulePromise) {
    clientServiceModulePromise = import("../src/services/client-service.js");
  }
  return clientServiceModulePromise;
}

function loadInventoryServiceModule() {
  if (!inventoryServiceModulePromise) {
    inventoryServiceModulePromise = import("../src/services/inventory-service.js");
  }
  return inventoryServiceModulePromise;
}

function loadAppointmentServiceModule() {
  if (!appointmentServiceModulePromise) {
    appointmentServiceModulePromise = import("../src/services/appointment-service.js");
  }
  return appointmentServiceModulePromise;
}

function loadSalesServiceModule() {
  if (!salesServiceModulePromise) {
    salesServiceModulePromise = import("../src/services/sales-service.js");
  }
  return salesServiceModulePromise;
}

const ipcHandlers = Object.freeze({
  [IPC_CHANNELS.AUTH_GET_CURRENT_USER]: async () => (await loadSyncEngineModule()).getCurrentRemoteUser(),
  [IPC_CHANNELS.SYNC_STATUS]: async () => (await loadSyncEngineModule()).getSyncEngineStatus(),
  [IPC_CHANNELS.SYNC_RUN]: async () => (await loadSyncEngineModule()).runSyncCycle(),
  [IPC_CHANNELS.SUMMARY_GET]: async () => (await loadSummaryRepoModule()).getOfflineSummary(),
  [IPC_CHANNELS.ANALYTICS_DAILY_SALES]: async (payload = {}) => (await loadSyncEngineModule()).getRemoteDailySales(payload),
  [IPC_CHANNELS.ANALYTICS_TOP_MEDICINES]: async (payload = {}) => (await loadSyncEngineModule()).getRemoteTopMedicines(payload),
  [IPC_CHANNELS.ANALYTICS_EXPIRY_LOSS]: async (payload = {}) => (await loadSyncEngineModule()).getRemoteExpiryLoss(payload),
  [IPC_CHANNELS.CLIENTS_LIST]: async () => (await loadClientServiceModule()).listLocalClients(),
  [IPC_CHANNELS.INVENTORY_LIST]: async () => (await loadInventoryServiceModule()).listInventoryBatches(),
  [IPC_CHANNELS.INVENTORY_CREATE]: async (payload = {}) => (await loadInventoryServiceModule()).createInventoryBatch(payload),
  [IPC_CHANNELS.INVENTORY_UPDATE]: async (payload = {}) => (
    await (await loadInventoryServiceModule()).updateInventoryBatch(payload.batchId, payload.payload ?? {})
  ),
  [IPC_CHANNELS.INVENTORY_ADJUST]: async (payload = {}) => (
    await (await loadInventoryServiceModule()).adjustInventoryBatch(payload.batchId, payload.delta, payload.reason)
  ),
  [IPC_CHANNELS.APPOINTMENTS_LIST]: async () => (await loadAppointmentServiceModule()).listLocalAppointments(),
  [IPC_CHANNELS.APPOINTMENTS_CREATE]: async (payload = {}) => (await loadAppointmentServiceModule()).createAppointment(payload),
  [IPC_CHANNELS.INVOICES_CREATE]: async (payload = {}) => (await loadSalesServiceModule()).createInvoice(payload, "desktop-user")
});

function buildReceiptHtml(payload = {}) {
  const language = payload.language === "ar" ? "ar" : "en";
  const dir = language === "ar" ? "rtl" : "ltr";
  const title = language === "ar" ? "إيصال صيدلية" : "Pharmacy Receipt";
  const labels = language === "ar"
    ? {
      total: "الإجمالي",
      payment: "طريقة الدفع",
      invoice: "الفاتورة",
      date: "التاريخ",
      item: "الصنف",
      qty: "الكمية",
      price: "السعر"
    }
    : {
      total: "Total",
      payment: "Payment",
      invoice: "Invoice",
      date: "Date",
      item: "Item",
      qty: "Qty",
      price: "Price"
    };

  const items = Array.isArray(payload.items) ? payload.items : [];
  const totalMinor = Number(payload.totalMinor ?? 0);
  const rows = items.map((item) => `
    <tr>
      <td>${item.name ?? labels.item}</td>
      <td>${Number(item.qty ?? 0)}</td>
      <td>${(Number(item.unitPriceMinor ?? 0) / 100).toFixed(2)}</td>
    </tr>
  `).join("");

  return `<!doctype html>
  <html lang="${language}" dir="${dir}">
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Tahoma, Arial, sans-serif; width: 76mm; margin: 0 auto; padding: 8px; color: #111; }
        h1 { font-size: 16px; margin: 0 0 8px; text-align: center; }
        .meta { font-size: 12px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        td, th { border-bottom: 1px dashed #bbb; padding: 4px 0; text-align: ${dir === "rtl" ? "right" : "left"}; }
        .total { margin-top: 8px; font-size: 14px; font-weight: 700; display: flex; justify-content: space-between; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div class="meta">${labels.invoice}: ${payload.invoiceNumber ?? "-"}</div>
      <div class="meta">${labels.date}: ${payload.issuedAt ?? new Date().toISOString()}</div>
      <div class="meta">${labels.payment}: ${payload.paymentMethod ?? "-"}</div>
      <table>
        <thead><tr><th>${labels.item}</th><th>${labels.qty}</th><th>${labels.price}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total"><span>${labels.total}</span><span>${(totalMinor / 100).toFixed(2)}</span></div>
    </body>
  </html>`;
}

async function printReceipt(payload) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true }
  });
  const html = buildReceiptHtml(payload);
  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const didPrint = await new Promise((resolve, reject) => {
    printWindow.webContents.print(
      { silent: false, printBackground: true },
      (success, errorType) => {
        if (!success && errorType) {
          reject(new Error(`Receipt print failed: ${errorType}`));
          return;
        }
        resolve(success);
      }
    );
  });

  printWindow.close();
  return { printed: Boolean(didPrint) };
}

function registerIpcHandlers() {
  for (const [channel, handler] of Object.entries(ipcHandlers)) {
    ipcMain.handle(channel, async (_event, payload) => handler(payload));
  }
  ipcMain.handle(IPC_CHANNELS.RECEIPT_PRINT, async (_event, payload) => printReceipt(payload));
}

async function bootDesktopServer() {
  process.env.PORT = process.env.PORT || "4173";
  process.env.PHARMASYNC_DATA_DIR = process.env.PHARMASYNC_DATA_DIR || app.getPath("userData");
  const appPath = app.getAppPath();
  const directServerPath = join(appPath, "server.js");
  const parentServerPath = join(appPath, "..", "server.js");
  const serverEntry = existsSync(directServerPath) ? directServerPath : parentServerPath;
  await import(pathToFileURL(serverEntry).href);
}

async function createWindow() {
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
      const builtReactIndex = join(app.getAppPath(), "desktop", "react", "dist", "index.html");
      if (existsSync(builtReactIndex)) {
        await mainWindow.loadFile(builtReactIndex);
        return;
      }
      await mainWindow.loadFile(join(app.getAppPath(), "desktop", "react-shell.html"));
      return;
    }
  }

  await bootDesktopServer();
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
