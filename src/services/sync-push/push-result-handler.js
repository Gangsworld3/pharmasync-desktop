export function parsePushBatchResult({ response, body, helpers }) {
  return {
    ok: response.ok,
    status: response.status,
    results: body.data?.results ?? [],
    conflicts: body.data?.conflicts ?? [],
    serverChanges: helpers.sortServerChanges(body.data?.serverChanges ?? [])
  };
}
