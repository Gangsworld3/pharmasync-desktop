import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "./ipc-channels.js";

let mainWindow = null;
const uiMode = process.env.PHARMASYNC_UI_MODE === "react" ? "react" : "legacy";
const reactDevUrl = process.env.PHARMASYNC_REACT_DEV_URL || "http://127.0.0.1:5173";
const localApiBase = "http://127.0.0.1:4173";

const routeMap = Object.freeze({
  [IPC_CHANNELS.SYNC_STATUS]: { method: "GET", path: "/api/local/sync/status" },
  [IPC_CHANNELS.SYNC_RUN]: { method: "POST", path: "/api/local/sync/run" },
  [IPC_CHANNELS.AUTH_GET_CURRENT_USER]: { method: "GET", path: "/api/local/auth/me" },
  [IPC_CHANNELS.SUMMARY_GET]: { method: "GET", path: "/api/local/summary" },
  [IPC_CHANNELS.ANALYTICS_DAILY_SALES]: {
    method: "GET",
    dynamicPath: ({ from, to }) => `/api/local/analytics/daily-sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  },
  [IPC_CHANNELS.ANALYTICS_TOP_MEDICINES]: {
    method: "GET",
    dynamicPath: ({ from, to, limit }) =>
      `/api/local/analytics/top-medicines?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${encodeURIComponent(limit ?? 10)}`
  },
  [IPC_CHANNELS.ANALYTICS_EXPIRY_LOSS]: {
    method: "GET",
    dynamicPath: ({ days }) => `/api/local/analytics/expiry-loss?days=${encodeURIComponent(days ?? 30)}`
  },
  [IPC_CHANNELS.CLIENTS_LIST]: { method: "GET", path: "/api/local/clients" },
  [IPC_CHANNELS.INVENTORY_LIST]: { method: "GET", path: "/api/local/inventory" },
  [IPC_CHANNELS.INVENTORY_CREATE]: { method: "POST", path: "/api/local/inventory" },
  [IPC_CHANNELS.INVENTORY_UPDATE]: { method: "PATCH", dynamicPath: ({ batchId }) => `/api/local/inventory/${batchId}`, unwrapPayload: "payload" },
  [IPC_CHANNELS.INVENTORY_ADJUST]: { method: "POST", dynamicPath: ({ batchId }) => `/api/local/inventory/${batchId}/adjust`, stripFields: ["batchId"] },
  [IPC_CHANNELS.APPOINTMENTS_LIST]: { method: "GET", path: "/api/local/appointments" },
  [IPC_CHANNELS.INVOICES_CREATE]: { method: "POST", path: "/api/local/invoices" },
  [IPC_CHANNELS.APPOINTMENTS_CREATE]: { method: "POST", path: "/api/local/appointments" }
});

async function invokeLocalApi(channel, payload = null) {
  const route = routeMap[channel];
  if (!route) {
    throw new Error(`Unsupported IPC channel: ${channel}`);
  }

  const targetPath = route.dynamicPath ? route.dynamicPath(payload ?? {}) : route.path;
  const bodyPayload = route.unwrapPayload && payload ? payload[route.unwrapPayload] : payload;
  const finalBody = route.stripFields && bodyPayload
    ? Object.fromEntries(Object.entries(bodyPayload).filter(([key]) => !route.stripFields.includes(key)))
    : bodyPayload;

  const response = await fetch(`${localApiBase}${targetPath}`, {
    method: route.method,
    headers: finalBody ? { "Content-Type": "application/json" } : undefined,
    body: finalBody ? JSON.stringify(finalBody) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = data?.detail || data?.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data;
}

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
  for (const channel of Object.keys(routeMap)) {
    ipcMain.handle(channel, async (_event, payload) => invokeLocalApi(channel, payload));
  }
  ipcMain.handle(IPC_CHANNELS.RECEIPT_PRINT, async (_event, payload) => printReceipt(payload));
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
