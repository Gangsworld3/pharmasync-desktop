const counters = new Map();
const timings = new Map();
const MAX_TIMING_SAMPLES = 500;

function increment(name, value = 1) {
  counters.set(name, (counters.get(name) || 0) + value);
}

function timing(name, durationMs) {
  if (!timings.has(name)) {
    timings.set(name, []);
  }
  const samples = timings.get(name);
  samples.push(Number(durationMs) || 0);
  if (samples.length > MAX_TIMING_SAMPLES) {
    samples.shift();
  }
}

function snapshot() {
  return {
    counters: Object.fromEntries(counters),
    timings: Object.fromEntries(
      Array.from(timings.entries()).map(([key, values]) => [
        key,
        {
          count: values.length,
          avg: values.reduce((sum, current) => sum + current, 0) / values.length || 0,
          max: Math.max(...values, 0)
        }
      ])
    )
  };
}

function reset() {
  counters.clear();
  timings.clear();
}

export const metrics = {
  increment,
  timing,
  snapshot,
  reset
};
