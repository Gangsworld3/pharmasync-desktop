export function createApiClientPort(deps) {
  return {
    requestJson: deps.authorizedJsonRequest
  };
}
