function isTimeoutError(err) {
  return err?.code === "P1008";
}

export async function withDbRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0 && isTimeoutError(err)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return withDbRetry(fn, retries - 1);
    }
    throw err;
  }
}

export { isTimeoutError };
