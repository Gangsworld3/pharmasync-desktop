function merge(local, remote) {
  return {
    ...remote,
    ...local
  };
}

export function resolveConflict(local, remote) {
  if (local.updatedAt > remote.updatedAt) {
    return local;
  }

  if (remote.priority === "server") {
    return remote;
  }

  return merge(local, remote);
}
