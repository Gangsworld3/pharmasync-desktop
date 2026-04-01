export async function isolate(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[ISOLATED FAILURE] ${label}`, err);
    return { success: false, error: err.message };
  }
}
