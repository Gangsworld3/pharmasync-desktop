export function isExpired(expiry) {
  if (!expiry) return false;
  const parsed = new Date(expiry);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed <= new Date();
}

export function isNearExpiry(expiry, days = 90) {
  if (!expiry || isExpired(expiry)) return false;
  const parsed = new Date(expiry);
  if (Number.isNaN(parsed.getTime())) return false;
  const diff = (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff < days;
}

export function selectFEFOBatch(batches) {
  const now = Date.now();
  return (
    [...(batches ?? [])]
      .filter((batch) => Number(batch?.quantity ?? 0) > 0)
      .filter((batch) => {
        if (!batch?.expiry) return true;
        const expiresAt = new Date(batch.expiry).getTime();
        return Number.isFinite(expiresAt) && expiresAt > now;
      })
      .sort((left, right) => {
        const leftExpiry = left?.expiry ? new Date(left.expiry).getTime() : Number.POSITIVE_INFINITY;
        const rightExpiry = right?.expiry ? new Date(right.expiry).getTime() : Number.POSITIVE_INFINITY;
        return leftExpiry - rightExpiry;
      })[0] || null
  );
}
