import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "./ipc-channels.js";
import {
  getCurrentRemoteUser,
  getRemoteDailySales,
  getRemoteExpiryLoss,
  getRemoteTopMedicines,
  getSyncEngineStatus,
  runSyncCycle
} from "../src/services/sync-engine.js";
import { getOfflineSummary } from "../src/db/repositories.js";
import { listLocalClients } from "../src/services/client-service.js";
import {
  adjustInventoryBatch,
  createInventoryBatch,
  listInventoryBatches,
  updateInventoryBatch
} from "../src/services/inventory-service.js";
import { listLocalAppointments, createAppointment } from "../src/services/appointment-service.js";
import { createInvoice } from "../src/services/sales-service.js";

let mainWindow = null;
const uiMode = process.env.PHARMASYNC_UI_MODE === "react" ? "react" : "legacy";
const reactDevUrl = process.env.PHARMASYNC_REACT_DEV_URL || "http://127.0.0.1:5173";
const localApiBase = "http://127.0.0.1:4173";

const ipcHandlers = Object.freeze({
  [IPC_CHANNELS.AUTH_GET_CURRENT_USER]: () => getCurrentRemoteUser(),
  [IPC_CHANNELS.SYNC_STATUS]: () => getSyncEngineStatus(),
  [IPC_CHANNELS.SYNC_RUN]: () => runSyncCycle(),
  [IPC_CHANNELS.SUMMARY_GET]: () => getOfflineSummary(),
  [IPC_CHANNELS.ANALYTICS_DAILY_SALES]: (payload = {}) => getRemoteDailySales(payload),
  [IPC_CHANNELS.ANALYTICS_TOP_MEDICINES]: (payload = {}) => getRemoteTopMedicines(payload),
  [IPC_CHANNELS.ANALYTICS_EXPIRY_LOSS]: (payload = {}) => getRemoteExpiryLoss(payload),
  [IPC_CHANNELS.CLIENTS_LIST]: () => listLocalClients(),
  [IPC_CHANNELS.INVENTORY_LIST]: () => listInventoryBatches(),
  [IPC_CHANNELS.INVENTORY_CREATE]: (payload = {}) => createInventoryBatch(payload),
  [IPC_CHANNELS.INVENTORY_UPDATE]: (payload = {}) => updateInventoryBatch(payload.batchId, payload.payload ?? {}),
  [IPC_CHANNELS.INVENTORY_ADJUST]: (payload = {}) => adjustInventoryBatch(payload.batchId, payload.delta, payload.reason),
  [IPC_CHANNELS.APPOINTMENTS_LIST]: () => listLocalAppointments(),
  [IPC_CHANNELS.APPOINTMENTS_CREATE]: (payload = {}) => createAppointment(payload),
  [IPC_CHANNELS.INVOICES_CREATE]: (payload = {}) => createInvoice(payload, "desktop-user")
});

function buildReceiptHtml(payload = {}) {
  const language = payload.language === "ar" ? "ar" : "en";
  const dir = language === "ar" ? "rtl" : "ltr";
  const title = language === "ar" ? "إيصال صيدلية" : "Pharmacy Receipt";
  const labels = language === "ar"
    ? { total: "الإجمالي", payment: "طريقة الدفع", invoice: "الفاتورة", date: "التاريخ", qty: "الكمية", price: "السعر" }
    : { total: "Total", payment: "Payment", invoice: "Invoice", date: "Date", qty: "Qty", price: "Price" };

  const items = Array.isArray(payload.items) ? payload.items : [];
  const totalMinor = Number(payload.totalMinor ?? 0);
  const rows = items.map((item) => `
    <tr>
      <td>${item.name ?? "Item"}</td>
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
        <thead><tr><th>Item</th><th>${labels.qty}</th><th>${labels.price}</th></tr></thead>
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
  await import(pathToFileURL(join(app.getAppPath(), "server.js")).href);
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
