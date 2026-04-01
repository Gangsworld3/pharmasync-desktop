import {
  DEFAULT_MAX_REQUEST_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETRY_BASE_MS,
  RETRYABLE_STATUS_CODES,
  classifyErrorMessage,
  parseJsonSafe,
  sleep
} from "./sync-policy.js";

export function createSyncRemoteApi({
  desktopLog,
  desktopSession,
  getRemoteConfig,
  sanitizePositiveNumber,
  jitterMs
}) {
  let authToken = null;

  function saveAuthenticatedSession({ accessToken, email, role, tenantId }) {
    desktopSession.saveDesktopSession({
      accessToken,
      email,
      role: role ?? null,
      tenantId: tenantId ?? null,
      createdAt: new Date().toISOString()
    });
  }

  async function loginRemote({ baseUrl, email, password }) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error(`Remote authentication failed (${response.status}).`);
    }

    return response.json();
  }

  async function getAuthHeaders(forceRefresh = false) {
    const { baseUrl, email, password } = getRemoteConfig();
    const session = desktopSession.getDesktopSession();

    if (forceRefresh) {
      authToken = null;
    }

    if (!authToken && session?.accessToken && !forceRefresh) {
      authToken = session.accessToken;
    }

    if (!authToken && email && password) {
      const payload = await loginRemote({ baseUrl, email, password });
      authToken = payload.data.access_token;
      saveAuthenticatedSession({
        accessToken: authToken,
        email,
        role: payload.data.role,
        tenantId: payload.data.tenant_id
      });
    }

    if (!authToken) {
      throw new Error("Remote authentication required. Sign in from desktop settings.");
    }

    return {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json"
    };
  }

  async function requestWithRetry(url, init, config) {
    const maxRequestRetries = sanitizePositiveNumber(config.maxRequestRetries, DEFAULT_MAX_REQUEST_RETRIES);
    const timeoutMs = sanitizePositiveNumber(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRequestRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timer);

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRequestRetries) {
          await sleep(jitterMs((2 ** (attempt - 1)) * sanitizePositiveNumber(config.retryBaseMs, DEFAULT_RETRY_BASE_MS)));
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;

        const retryable = error?.name === "AbortError" || classifyErrorMessage(error);
        if (!retryable || attempt >= maxRequestRetries) {
          throw error;
        }

        await sleep(jitterMs((2 ** (attempt - 1)) * sanitizePositiveNumber(config.retryBaseMs, DEFAULT_RETRY_BASE_MS)));
      }
    }

    if (lastError?.name === "AbortError") {
      throw new Error(
        `Remote request timed out after ${timeoutMs}ms (${maxRequestRetries} attempts) for ${url}. ` +
        "Check backend URL reachability and request-timeout settings."
      );
    }

    throw lastError ?? new Error("Request failed.");
  }

  async function requestJson(path, init, config) {
    const response = await requestWithRetry(`${getRemoteConfig().baseUrl}${path}`, init, config);
    const raw = await response.text();
    const parsed = parseJsonSafe(raw);
    return { response, body: parsed };
  }

  async function authorizedJsonRequest(path, init) {
    const config = getRemoteConfig();
    let headers = await getAuthHeaders();
    let result = await requestJson(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, config);

    if (result.response.status === 401) {
      authToken = null;
      headers = await getAuthHeaders(true);
      result = await requestJson(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, config);
    }

    return result;
  }

  async function authenticateDesktopSession(email, password) {
    const { baseUrl } = getRemoteConfig();
    const payload = await loginRemote({ baseUrl, email, password });
    authToken = payload.data.access_token;
    saveAuthenticatedSession({
      accessToken: authToken,
      email,
      role: payload.data.role,
      tenantId: payload.data.tenant_id
    });
    desktopLog.appendDesktopLog("sync.log", `auth success email=${email}`);
    return { email, authenticated: true };
  }

  function logoutDesktopSession() {
    authToken = null;
    desktopSession.clearDesktopSession();
    desktopLog.appendDesktopLog("sync.log", "auth logout");
    return { authenticated: false };
  }

  async function getCurrentRemoteUser() {
    const { response, body } = await authorizedJsonRequest("/auth/me", { method: "GET" });
    if (!response.ok) {
      throw new Error(body?.error?.message || body?.detail || `Failed to fetch current user (${response.status}).`);
    }
    return body?.data ?? null;
  }

  async function fetchAnalytics(path, errorLabel) {
    const { response, body } = await authorizedJsonRequest(path, { method: "GET" });
    if (!response.ok) {
      throw new Error(body?.error?.message || body?.detail || `Failed to fetch ${errorLabel} (${response.status}).`);
    }
    return body?.data;
  }

  async function getRemoteDailySales(params = {}) {
    const fromDate = params.from;
    const toDate = params.to;
    if (!fromDate || !toDate) {
      throw new Error("daily-sales requires from and to dates.");
    }
    const query = new URLSearchParams({ from: fromDate, to: toDate });
    const data = await fetchAnalytics(`/analytics/daily-sales?${query.toString()}`, "daily sales");
    return data ?? [];
  }

  async function getRemoteTopMedicines(params = {}) {
    const fromDate = params.from;
    const toDate = params.to;
    const limit = Number(params.limit ?? 10);
    if (!fromDate || !toDate) {
      throw new Error("top-medicines requires from and to dates.");
    }
    const query = new URLSearchParams({ from: fromDate, to: toDate, limit: String(limit) });
    const data = await fetchAnalytics(`/analytics/top-medicines?${query.toString()}`, "top medicines");
    return data ?? [];
  }

  async function getRemoteExpiryLoss(params = {}) {
    const days = Number(params.days ?? 30);
    const query = new URLSearchParams({ days: String(days) });
    const data = await fetchAnalytics(`/analytics/expiry-loss?${query.toString()}`, "expiry loss");
    return data ?? null;
  }

  function clearAuthToken() {
    authToken = null;
  }

  return Object.freeze({
    authenticateDesktopSession,
    logoutDesktopSession,
    getCurrentRemoteUser,
    getRemoteDailySales,
    getRemoteTopMedicines,
    getRemoteExpiryLoss,
    authorizedJsonRequest,
    clearAuthToken
  });
}
