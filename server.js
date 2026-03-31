import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
// External/local HTTP API surface for web/mobile and legacy desktop shell.
// Electron IPC now calls service layer directly.
import "./src/db/init-sqlite.js";
import { bootstrapLocalDatabase } from "./src/db/bootstrap.js";
import {
  ensureDeviceState,
  getOfflineSummary,
  listConflictOperations,
  listAuditLogs,
  listLocalOperations,
  listMessages,
  listSyncQueue,
} from "./src/db/repositories.js";
import {
  resolveDesktopConflict,
  resolveConflict,
  runSyncRetryCycle
} from "./src/services/offline-service.js";
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
import { listLocalClients, createClient, updateClient } from "./src/services/client-service.js";
import {
  listInventoryBatches,
  createInventoryBatch,
  updateInventoryBatch,
  adjustInventoryBatch
} from "./src/services/inventory-service.js";
import { listLocalInvoices, createInvoice } from "./src/services/sales-service.js";
import { listLocalAppointments, createAppointment } from "./src/services/appointment-service.js";
import {
  exportLocalDatabase,
  getDesktopSettings,
  getRuntimePaths,
  saveDesktopSettings
} from "./src/services/desktop-runtime.js";

const runtimePaths = getRuntimePaths();
const root = normalize(join(runtimePaths.appRoot, "desktop"));
const port = Number(process.env.PORT || 4173);

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
  "/api/local/summary": getOfflineSummary,
  "/api/local/clients": listLocalClients,
  "/api/local/invoices": listLocalInvoices,
  "/api/local/inventory": listInventoryBatches,
  "/api/local/appointments": listLocalAppointments,
  "/api/local/messages": listMessages,
  "/api/local/sync-queue": listSyncQueue,
  "/api/local/audit-logs": listAuditLogs,
  "/api/local/sync/status": getSyncEngineStatus,
  "/api/local/operations": listLocalOperations,
  "/api/local/conflicts": listConflictOperations,
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
await ensureDeviceState();
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
      const result = await createInvoice(body, "desktop-user");
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/clients") {
      const body = await readJsonBody(req);
      const result = await createClient(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/appointments") {
      const body = await readJsonBody(req);
      const result = await createAppointment(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/inventory") {
      const body = await readJsonBody(req);
      const result = await createInventoryBatch(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "PATCH" && requestUrl.pathname.startsWith("/api/local/clients/")) {
      const clientId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await updateClient(clientId, body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "PATCH" && requestUrl.pathname.startsWith("/api/local/inventory/")) {
      const batchId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await updateInventoryBatch(batchId, body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/api/local/inventory/") && requestUrl.pathname.endsWith("/adjust")) {
      const parts = requestUrl.pathname.split("/");
      const batchId = parts[parts.length - 2];
      const body = await readJsonBody(req);
      const result = await adjustInventoryBatch(batchId, Number(body.delta ?? 0), body.reason ?? "manual-adjustment");
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/local/sync/retry") {
      const result = await runSyncRetryCycle();
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
      const result = await resolveConflict(queueId, body.resolution ?? "manual-accept-local", "desktop-user");
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/api/local/conflicts/")) {
      const conflictId = requestUrl.pathname.split("/").pop();
      const body = await readJsonBody(req);
      const result = await resolveDesktopConflict(conflictId, body, "desktop-user");
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
