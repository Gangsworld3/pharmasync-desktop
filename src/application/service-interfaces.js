function assertFunction(value, methodName, moduleName) {
  if (typeof value !== "function") {
    throw new Error(`Service contract violation: ${moduleName}.${methodName} must be a function.`);
  }
}

function assertServiceContract(service, moduleName, methodNames) {
  for (const methodName of methodNames) {
    assertFunction(service[methodName], methodName, moduleName);
  }
  return service;
}

export function asSyncEngineService(service) {
  return assertServiceContract(service, "sync-engine", [
    "getCurrentRemoteUser",
    "getSyncEngineStatus",
    "runSyncCycle",
    "getRemoteDailySales",
    "getRemoteTopMedicines",
    "getRemoteExpiryLoss"
  ]);
}

export function asSummaryService(service) {
  return assertServiceContract(service, "summaryRepo", ["getOfflineSummary"]);
}

export function asClientService(service) {
  return assertServiceContract(service, "client-service", ["listLocalClients"]);
}

export function asInventoryService(service) {
  return assertServiceContract(service, "inventory-service", [
    "listInventoryBatches",
    "createInventoryBatch",
    "updateInventoryBatch",
    "adjustInventoryBatch"
  ]);
}

export function asAppointmentService(service) {
  return assertServiceContract(service, "appointment-service", [
    "listLocalAppointments",
    "createAppointment"
  ]);
}

export function asSalesService(service) {
  return assertServiceContract(service, "sales-service", ["createInvoice"]);
}
