export function createOperationRepoPort(deps) {
  return {
    ensureDeviceState: deps.ensureDeviceState,
    listPendingOperations: deps.getPendingLocalOperations,
    listConflictOperations: deps.getConflictLocalOperations,
    recoverInProgressOperations: deps.recoverInProgressLocalOperations,
    updateDeviceState: deps.updateDeviceState,
    applyTransition: deps.applyOperationTransition,
    applyServerChange: deps.applyServerChange,
    recordLocalOperation: deps.appendLocalOperation
  };
}
