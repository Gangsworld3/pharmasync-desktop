import { IPC_CHANNELS } from "../../electron/ipc-channels.js";
import { randomUUID } from "node:crypto";
import {
  asAppointmentService,
  asClientService,
  asInventoryService,
  asSalesService,
  asSummaryService,
  asSyncEngineService
} from "./service-interfaces.js";
import { metrics } from "./metrics.js";
import { ExecutionIntelligence } from "./execution-intelligence.js";
import { DecisionEngine } from "./decision-engine.js";
import { detectFailures } from "./failure-detector.js";
import { RecoveryEngine } from "./recovery-engine.js";
import { traceStore } from "./trace-store.js";

function createLazyLoader(importer) {
  let modulePromise = null;
  return async () => {
    if (!modulePromise) {
      modulePromise = importer();
    }
    return modulePromise;
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("orchestrator.timeout")), ms)
    )
  ]);
}

function toSafeError(error) {
  return {
    message: error?.message || "Internal error"
  };
}

function getFailureState(failureMap, channel) {
  return failureMap.get(channel) ?? { failures: 0, lastFailureAt: 0 };
}

function isCircuitOpen(failureState, failureThreshold, cooldownMs, now) {
  if (failureState.failures < failureThreshold) {
    return false;
  }
  return now - failureState.lastFailureAt < cooldownMs;
}

export function createDesktopOrchestrator({
  eventBus,
  defaultTimeoutMs = 5000,
  failureThreshold = 5,
  cooldownMs = 10000
}) {
  const loadSyncEngine = createLazyLoader(async () => asSyncEngineService(await import("../services/sync-engine.js")));
  const loadSummaryRepo = createLazyLoader(async () => asSummaryService(await import("../db/repositories/summaryRepo.js")));
  const loadClientService = createLazyLoader(async () => asClientService(await import("../services/client-service.js")));
  const loadInventoryService = createLazyLoader(async () => asInventoryService(await import("../services/inventory-service.js")));
  const loadAppointmentService = createLazyLoader(async () => asAppointmentService(await import("../services/appointment-service.js")));
  const loadSalesService = createLazyLoader(async () => asSalesService(await import("../services/sales-service.js")));
  const logger = {
    warn: (...args) => eventBus.emit("orchestrator.recovery.warn", { message: args.join(" ") })
  };
  const recoveryMetrics = {
    get: (name) => {
      const snapshot = metrics.snapshot();
      const counter = snapshot?.counters?.[name];
      if (Number.isFinite(Number(counter))) {
        return Number(counter);
      }
      const avg = snapshot?.timings?.[name]?.avg;
      return Number.isFinite(Number(avg)) ? Number(avg) : 0;
    }
  };
  const recoveryEngine = new RecoveryEngine({ logger });
  const intelligence = new ExecutionIntelligence({ metrics });
  const decisionEngine = new DecisionEngine({
    intelligence,
    health: () => {
      const snapshot = metrics.snapshot();
      return {
        pressure: Number(snapshot?.counters?.["ipc.request.total"] ?? 0),
        instability: Number(snapshot?.counters?.["sync.fail.rate"] ?? 0)
      };
    }
  });
  const failureMap = new Map();

  const handlers = Object.freeze({
    GET_SYSTEM_TRACES: async () => traceStore.getAll(),
    [IPC_CHANNELS.AUTH_GET_CURRENT_USER]: async () => (await loadSyncEngine()).getCurrentRemoteUser(),
    [IPC_CHANNELS.SYNC_STATUS]: async () => (await loadSyncEngine()).getSyncEngineStatus(),
    [IPC_CHANNELS.SYNC_RUN]: async () => (await loadSyncEngine()).runSyncCycle(),
    [IPC_CHANNELS.SUMMARY_GET]: async () => (await loadSummaryRepo()).getOfflineSummary(),
    [IPC_CHANNELS.ANALYTICS_DAILY_SALES]: async (payload = {}) => (await loadSyncEngine()).getRemoteDailySales(payload),
    [IPC_CHANNELS.ANALYTICS_TOP_MEDICINES]: async (payload = {}) => (await loadSyncEngine()).getRemoteTopMedicines(payload),
    [IPC_CHANNELS.ANALYTICS_EXPIRY_LOSS]: async (payload = {}) => (await loadSyncEngine()).getRemoteExpiryLoss(payload),
    [IPC_CHANNELS.CLIENTS_LIST]: async () => (await loadClientService()).listLocalClients(),
    [IPC_CHANNELS.INVENTORY_LIST]: async () => (await loadInventoryService()).listInventoryBatches(),
    [IPC_CHANNELS.INVENTORY_CREATE]: async (payload = {}) => (await loadInventoryService()).createInventoryBatch(payload),
    [IPC_CHANNELS.INVENTORY_UPDATE]: async (payload = {}) => (
      await (await loadInventoryService()).updateInventoryBatch(payload.batchId, payload.payload ?? {})
    ),
    [IPC_CHANNELS.INVENTORY_ADJUST]: async (payload = {}) => (
      await (await loadInventoryService()).adjustInventoryBatch(payload.batchId, payload.delta, payload.reason)
    ),
    [IPC_CHANNELS.APPOINTMENTS_LIST]: async () => (await loadAppointmentService()).listLocalAppointments(),
    [IPC_CHANNELS.APPOINTMENTS_CREATE]: async (payload = {}) => (await loadAppointmentService()).createAppointment(payload),
    [IPC_CHANNELS.INVOICES_CREATE]: async (payload = {}) => (await loadSalesService()).createInvoice(payload, "desktop-user")
  });

  async function handleIpc(channel, payload = {}, options = {}) {
    const requestId = randomUUID();
    const handler = handlers[channel];
    const now = Date.now();
    metrics.increment("ipc.request.total");
    const failures = detectFailures(recoveryMetrics);

    if (Object.values(failures).some(Boolean)) {
      await recoveryEngine.recover(failures);
    }

    await eventBus.emit("orchestrator.request.received", {
      requestId,
      channel,
      payload
    });

    if (!handler) {
      const error = new Error(`Unsupported IPC channel: ${channel}`);
      await eventBus.emit("orchestrator.request.failed", {
        requestId,
        channel,
        error: error.message
      });
      return {
        success: false,
        error: toSafeError(error)
      };
    }

    const failureState = getFailureState(failureMap, channel);
    if (isCircuitOpen(failureState, failureThreshold, cooldownMs, now)) {
      const error = new Error("orchestrator.circuit_open");
      metrics.increment("ipc.circuit.open");
      metrics.increment("ipc.request.failure");
      await eventBus.emit("orchestrator.circuit.open", { channel });
      await eventBus.emit("orchestrator.request.failed", {
        requestId,
        channel,
        error: error.message
      });
      return {
        success: false,
        error: toSafeError(error)
      };
    }

    const startedAt = Date.now();
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : defaultTimeoutMs;
    const operation = {
      channel,
      payload,
      priority: payload?.priority ?? "normal"
    };
    const systemState = {
      isOffline: Boolean(options?.isOffline ?? payload?.isOffline ?? payload?.systemState?.isOffline)
    };

    const queueOperation = async () => {
      metrics.increment("ipc.request.queued");
      await eventBus.emit("orchestrator.request.queued", {
        requestId,
        channel
      });
      return {
        success: true,
        data: {
          queued: true,
          channel
        }
      };
    };

    const scheduleRetry = async () => {
      metrics.increment("ipc.request.deferred");
      await eventBus.emit("orchestrator.request.deferred", {
        requestId,
        channel
      });
      return {
        success: true,
        data: {
          deferred: true,
          channel
        }
      };
    };

    const delayExecution = async () => {
      metrics.increment("ipc.request.throttled");
      await eventBus.emit("orchestrator.request.throttled", {
        requestId,
        channel
      });
      return {
        success: true,
        data: {
          throttled: true,
          channel
        }
      };
    };

    const fallbackExecution = async () => {
      metrics.increment("ipc.request.safe_mode");
      await eventBus.emit("orchestrator.request.safe_mode", {
        requestId,
        channel
      });
      return executeNow();
    };

    const executeNow = async () => {
      try {
        const data = await withTimeout(handler(payload), timeoutMs);
        failureMap.delete(channel);
        const durationMs = Date.now() - startedAt;
        metrics.increment("ipc.request.success");
        metrics.timing("ipc.request.duration", durationMs);
        await eventBus.emit("orchestrator.request.completed", {
          requestId,
          channel,
          durationMs
        });
        return {
          success: true,
          data
        };
      } catch (error) {
        const state = getFailureState(failureMap, channel);
        failureMap.set(channel, {
          failures: state.failures + 1,
          lastFailureAt: Date.now()
        });
        metrics.increment("ipc.request.failure");

        await eventBus.emit("orchestrator.request.failed", {
          requestId,
          channel,
          durationMs: Date.now() - startedAt,
          error: error?.message || "Internal error"
        });
        return {
          success: false,
          error: toSafeError(error)
        };
      }
    };

    const decision = decisionEngine.decide({
      operation,
      systemState
    });

    switch (decision.action) {
    case "throttle":
      return delayExecution();
    case "safe-mode":
      return fallbackExecution();
    case "queue":
      return queueOperation();
    case "defer":
      return scheduleRetry();
    case "immediate":
      return executeNow();
    case "normal":
    default:
      return executeNow();
    }
  }

  return Object.freeze({
    handleIpc
  });
}
