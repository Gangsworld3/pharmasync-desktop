import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
// External/local HTTP API surface for web/mobile and legacy desktop shell.
// Electron IPC now calls service layer directly.
import "./src/db/init-sqlite.js";
import { bootstrapLocalDatabase } from "./src/db/bootstrap.js";
import {
  authenticateDesktopSession,
  getCurrentRemoteUser,
  getRemoteDailySales,
  getRemoteExpiryLoss,
  getRemoteTopMedicines,
  getSyncEngineStatus,
  logoutDesktopSession,
  recordLocalOperation,
  runSyncCycle,
  startBackgroundSyncLoop
} from "./src/services/sync-engine.js";
import {
  exportLocalDatabase,
  getDesktopSettings,
  getRuntimePaths,
  saveDesktopSettings
} from "./src/services/desktop-runtime.js";

const runtimePaths = getRuntimePaths();
const root = normalize(join(runtimePaths.appRoot, "desktop"));
const port = Number(process.env.PORT || 4173);
let repositoriesModulePromise = null;
let clientsModulePromise = null;
let inventoryModulePromise = null;
let appointmentsModulePromise = null;
let salesModulePromise = null;
let offlineModulePromise = null;

function loadRepositoriesModule() {
  if (!repositoriesModulePromise) {
    repositoriesModulePromise = import("./src/db/repositories.js");
  }
  return repositoriesModulePromise;
}

function loadClientsModule() {
  if (!clientsModulePromise) {
    clientsModulePromise = import("./src/services/client-service.js");
  }
  return clientsModulePromise;
}

function loadInventoryModule() {
  if (!inventoryModulePromise) {
    inventoryModulePromise = import("./src/services/inventory-service.js");
  }
  return inventoryModulePromise;
}

function loadAppointmentsModule() {
  if (!appointmentsModulePromise) {
    appointmentsModulePromise = import("./src/services/appointment-service.js");
  }
  return appointmentsModulePromise;
}

function loadSalesModule() {
  if (!salesModulePromise) {
    salesModulePromise = import("./src/services/sales-service.js");
  }
  return salesModulePromise;
}

function loadOfflineModule() {
  if (!offlineModulePromise) {
    offlineModulePromise = import("./src/services/offline-service.js");
  }
  return offlineModulePromise;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

const getRoutes = {
  "/api/local/summary": async () => (await loadRepositoriesModule()).getOfflineSummary(),
  "/api/local/clients": async () => (await loadClientsModule()).listLocalClients(),
  "/api/local/invoices": async () => (await loadSalesModule()).listLocalInvoices(),
  "/api/local/inventory": async () => (await loadInventoryModule()).listInventoryBatches(),
  "/api/local/appointments": async () => (await loadAppointmentsModule()).listLocalAppointments(),
  "/api/local/messages": async () => (await loadRepositoriesModule()).listMessages(),
  "/api/local/sync-queue": async () => (await loadRepositoriesModule()).listSyncQueue(),
  "/api/local/audit-logs": async () => (await loadRepositoriesModule()).listAuditLogs(),
  "/api/local/sync/status": getSyncEngineStatus,
  "/api/local/operations": async () => (await loadRepositoriesModule()).listLocalOperations(),
  "/api/local/conflicts": async () => (await loadRepositoriesModule()).listConflictOperations(),
  "/api/local/settings": getDesktopSettings,
  "/api/local/app-meta": () => ({
    version: "1.0.0",
    runtimePaths: getRuntimePaths()
  })
};

function resolvePath(urlPath) {
  const sanitized = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(join(root, sanitized));
  return filePath.startsWith(root) ? filePath : null;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

await bootstrapLocalDatabase();
await (await loadRepositoriesModule()).ensureDeviceState();
await startBackgroundSyncLoop();

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && getRoutes[requestUrl.pathname]) {
      sendJson(res, 200, await getRoutes[requestUrl.pathname]());
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/invoices") {
      const body = await readJsonBody(req);
      const result = await (await loadSalesModule()).createInvoice(body, "desktop-user");
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/clients") {
      const body = await readJsonBody(req);
      const result = await (await loadClientsModule()).createClient(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/appointments") {
      const body = await readJsonBody(req);
      const result = await (await loadAppointmentsModule()).createAppointment(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/inventory") {
      const body = await readJsonBody(req);
      const result = await (await loadInventoryModule()).createInventoryBatch(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "PATCH" && requestUrl.pathname.startsWith("/api/local/clients/")) {
      const clientId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await (await loadClientsModule()).updateClient(clientId, body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "PATCH" && requestUrl.pathname.startsWith("/api/local/inventory/")) {
      const batchId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await (await loadInventoryModule()).updateInventoryBatch(batchId, body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/api/local/inventory/") && requestUrl.pathname.endsWith("/adjust")) {
      const parts = requestUrl.pathname.split("/");
      const batchId = parts[parts.length - 2];
      const body = await readJsonBody(req);
      const result = await (await loadInventoryModule()).adjustInventoryBatch(
        batchId,
        Number(body.delta ?? 0),
        body.reason ?? "manual-adjustment"
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/sync/retry") {
      const result = await (await loadOfflineModule()).runSyncRetryCycle();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/sync/run") {
      const result = await runSyncCycle();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/settings") {
      const body = await readJsonBody(req);
      const result = await saveDesktopSettings(body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/backup/export") {
      const targetPath = exportLocalDatabase();
      sendJson(res, 200, { targetPath });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/auth/login") {
      const body = await readJsonBody(req);
      const result = await authenticateDesktopSession(body.email, body.password);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/auth/logout") {
      const result = logoutDesktopSession();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/local/auth/me") {
      const result = await getCurrentRemoteUser();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/local/analytics/daily-sales") {
      const result = await getRemoteDailySales({
        from: requestUrl.searchParams.get("from"),
        to: requestUrl.searchParams.get("to")
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/local/analytics/top-medicines") {
      const result = await getRemoteTopMedicines({
        from: requestUrl.searchParams.get("from"),
        to: requestUrl.searchParams.get("to"),
        limit: requestUrl.searchParams.get("limit")
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/local/analytics/expiry-loss") {
      const result = await getRemoteExpiryLoss({
        days: requestUrl.searchParams.get("days")
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/operations") {
      const body = await readJsonBody(req);
      const result = await recordLocalOperation(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/api/local/sync/conflicts/")) {
      const queueId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await (await loadOfflineModule()).resolveConflict(
        queueId,
        body.resolution ?? "manual-accept-local",
        "desktop-user"
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/api/local/conflicts/")) {
      const conflictId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await (await loadOfflineModule()).resolveDesktopConflict(conflictId, body, "desktop-user");
      sendJson(res, 200, result);
      return;
    }
  } catch (error) {
    sendJson(res, 400, { error: "offline_service_error", detail: error.message });
    return;
  }

  const target = resolvePath(requestUrl.pathname);

  if (!target || !existsSync(target) || statSync(target).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(target)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  createReadStream(target).pipe(res);
}).listen(port, () => {
  console.log(`PharmaSync desktop shell running at http://localhost:${port}`);
});
