export function expiryStatus(dateValue) {
  const days = (new Date(dateValue).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (Number.isNaN(days)) {
    return { type: "warning", labelKey: "statusWarning" };
  }
  if (days < 0) {
    return { type: "expired", labelKey: "statusExpired" };
  }
  if (days < 90) {
    return { type: "warning", labelKey: "statusWarning" };
  }
  return { type: "ok", labelKey: "statusOk" };
}
