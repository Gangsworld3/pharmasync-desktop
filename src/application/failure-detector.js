export function detectFailures(metrics) {
  return {
    dbDown: metrics.get("db.connection.fail") > 0,
    syncBroken: metrics.get("sync.fail.rate") > 0.5,
    overload: metrics.get("event.loop.lag") > 200
  };
}
