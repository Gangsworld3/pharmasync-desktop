export function createClockPort() {
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
    setTimeout: (fn, delayMs) => setTimeout(fn, delayMs),
    clearTimeout: (timerId) => clearTimeout(timerId)
  };
}
