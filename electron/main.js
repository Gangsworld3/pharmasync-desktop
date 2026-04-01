import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { IPC_CHANNELS } from "./ipc-channels.js";
import { createEventBus } from "../src/application/event-bus.js";
import { createDesktopOrchestrator } from "../src/application/desktop-orchestrator.js";
import { appendAppJsonLog } from "../src/application/app-logger.js";

let mainWindow = null;
process.env.DESKTOP_MODE = process.env.DESKTOP_MODE || "ipc";
if (process.env.DESKTOP_MODE !== "ipc") {
  throw new Error("Unsupported runtime mode");
}

const reactDevUrl = process.env.PHARMASYNC_REACT_DEV_URL || "http://127.0.0.1:5173";

const eventBus = createEventBus({
  logger: (filename, payload) => appendAppJsonLog(filename, payload)
});
const orchestrator = createDesktopOrchestrator({ eventBus });

eventBus.registerRuleHook(async (eventEnvelope) => {
  if (eventEnvelope.name !== "orchestrator.request.failed") {
    return;
  }
  await eventBus.emit("anomaly.detected", {
    source: "ipc-orchestrator",
    channel: eventEnvelope.payload.channel,
    error: eventEnvelope.payload.error
  });
});

function buildReceiptHtml(payload = {}) {
  const language = payload.language === "ar" ? "ar" : "en";
  const dir = language === "ar" ? "rtl" : "ltr";
  const title = language === "ar" ? "\u0625\u064a\u0635\u0627\u0644 \u0635\u064a\u062f\u0644\u064a\u0629" : "Pharmacy Receipt";
  const labels = language === "ar"
    ? {
      total: "\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a",
      payment: "\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639",
      invoice: "\u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629",
      date: "\u0627\u0644\u062a\u0627\u0631\u064a\u062e",
      item: "\u0627\u0644\u0635\u0646\u0641",
      qty: "\u0627\u0644\u0643\u0645\u064a\u0629",
      price: "\u0627\u0644\u0633\u0639\u0631"
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
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel === IPC_CHANNELS.RECEIPT_PRINT) {
      continue;
    }
    ipcMain.handle(channel, async (_event, payload) => orchestrator.handleIpc(channel, payload));
  }
  ipcMain.handle(IPC_CHANNELS.RECEIPT_PRINT, async (_event, payload) => printReceipt(payload));
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

  try {
    await mainWindow.loadURL(reactDevUrl);
    return;
  } catch (error) {
    console.warn(`[electron] React dev server unavailable at ${reactDevUrl}: ${error?.message ?? "load failure"}`);
    const builtReactIndex = join(app.getAppPath(), "desktop", "react", "dist", "index.html");
    if (existsSync(builtReactIndex)) {
      console.warn(`[electron] Falling back to built React bundle: ${builtReactIndex}`);
      await mainWindow.loadFile(builtReactIndex);
      return;
    }
    console.warn("[electron] Falling back to react-shell placeholder.");
    await mainWindow.loadFile(join(app.getAppPath(), "desktop", "react-shell.html"));
  }
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
