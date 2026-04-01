export function traceDecision({ context, decision, health }) {
  return {
    timestamp: Date.now(),
    context,
    decision,
    health
  };
}
