import {
  appendLocalOperation,
  ensureDeviceState,
  getConflictLocalOperations,
  getDeviceState,
  getPendingLocalOperations,
  recoverInProgressLocalOperations,
  updateDeviceState,
  updateLocalOperation
} from "../db/repositories/syncRepo.js";
import {
  appendMessageFromServer,
  upsertAppointmentFromServer,
  upsertClientFromServer,
  upsertInventoryFromServer,
  upsertInvoiceFromServer
} from "../db/repositories/syncApplyRepo.js";
import {
  appendDesktopLog,
  appendDesktopJsonLog,
  clearDesktopSession,
  getDesktopSession,
  getDesktopSettings,
  saveDesktopSession
} from "./desktop-runtime.js";
import { createApiClientPort } from "./ports/api-client.port.js";
import { createClockPort } from "./ports/clock.port.js";
import { createOperationRepoPort } from "./ports/operation-repo.port.js";

export const syncRepo = {
  appendLocalOperation,
  ensureDeviceState,
  getConflictLocalOperations,
  getDeviceState,
  getPendingLocalOperations,
  recoverInProgressLocalOperations,
  updateDeviceState,
  updateLocalOperation
};

export const syncApplyRepo = {
  appendMessageFromServer,
  upsertAppointmentFromServer,
  upsertClientFromServer,
  upsertInventoryFromServer,
  upsertInvoiceFromServer
};

export const desktopSession = {
  clearDesktopSession,
  getDesktopSession,
  getDesktopSettings,
  saveDesktopSession
};

export const desktopLog = {
  appendDesktopLog,
  appendDesktopJsonLog
};

export const syncPorts = {
  createApiClientPort,
  createClockPort,
  createOperationRepoPort
};
