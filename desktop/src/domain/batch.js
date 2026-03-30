export function sortByFEFO(batches) {
  return [...batches].sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
}
