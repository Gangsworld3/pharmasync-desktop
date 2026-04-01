export function detectPatterns(traces) {
  const result = {
    frequentSafeMode: false,
    risingPressure: false,
    highInstability: false,
    confidence: 0
  };

  if (!Array.isArray(traces) || traces.length < 10) {
    return result;
  }

  // Focus on recent window
  const recent = traces.slice(-30);

  // --- SAFE MODE FREQUENCY ---
  const safeModeCount = recent.filter(
    (t) => t?.decision?.action === "safe-mode"
  ).length;

  if (safeModeCount >= 5) {
    result.frequentSafeMode = true;
    result.confidence += 0.4;
  }

  // --- PRESSURE TREND ---
  const firstPressure = recent[0]?.health?.pressure ?? 0;
  const lastPressure = recent[recent.length - 1]?.health?.pressure ?? 0;

  if (lastPressure - firstPressure > 20) {
    result.risingPressure = true;
    result.confidence += 0.3;
  }

  // --- INSTABILITY SIGNAL ---
  const instabilityCount = recent.filter(
    (t) => (t?.health?.instability ?? 0) > 0.5
  ).length;

  if (instabilityCount >= 5) {
    result.highInstability = true;
    result.confidence += 0.3;
  }

  return result;
}
