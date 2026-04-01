const CONNECTION_STATES = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting"
});

export function createRealtimeSyncController({
  desktopLog,
  desktopSession,
  getRemoteConfig,
  runSyncCycle,
  sanitizePositiveNumber,
  defaultRealtimeRetryBaseMs,
  defaultRealtimeRetryMaxMs,
  eventBus
}) {
  let connectionState = CONNECTION_STATES.IDLE;
  let currentSubscription = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let realtimeEnabled = false;
  let isDisconnecting = false;
  const processedEventIds = new Set();

  async function emitEvent(name, payload = {}) {
    if (eventBus && typeof eventBus.emit === "function") {
      await eventBus.emit(name, payload);
      return;
    }
    desktopLog.appendDesktopJsonLog("sync.log", {
      event: name,
      at: new Date().toISOString(),
      ...payload
    });
  }

  function cleanupSubscription() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentSubscription) {
      try {
        if (typeof currentSubscription.unsubscribe === "function") {
          currentSubscription.unsubscribe();
        } else if (typeof currentSubscription.close === "function") {
          currentSubscription.close();
        }
      } catch {
        // no-op
      }
      currentSubscription = null;
    }
  }

  function getBackoffDelay() {
    const { realtimeRetryBaseMs, realtimeRetryMaxMs } = getRemoteConfig();
    const base = sanitizePositiveNumber(realtimeRetryBaseMs, defaultRealtimeRetryBaseMs);
    const max = sanitizePositiveNumber(realtimeRetryMaxMs, defaultRealtimeRetryMaxMs);
    const delay = Math.min(base * (2 ** reconnectAttempts), max);
    return Math.max(250, delay);
  }

  async function handleRemoteChange(payload) {
    const id = payload?.event_id || JSON.stringify(payload);
    if (processedEventIds.has(id)) {
      return;
    }

    processedEventIds.add(id);
    if (processedEventIds.size > 1000) {
      processedEventIds.clear();
    }

    await emitEvent("sync.remote.change", payload);
    if (payload?.type === "sync.revision") {
      void runSyncCycle();
    }
  }

  async function handleDisconnect() {
    if (isDisconnecting) {
      return;
    }

    isDisconnecting = true;

    try {
      cleanupSubscription();

      connectionState = CONNECTION_STATES.DISCONNECTED;
      await emitEvent("sync.disconnected");

      if (!realtimeEnabled) {
        connectionState = CONNECTION_STATES.IDLE;
        return;
      }

      reconnectAttempts += 1;
      connectionState = CONNECTION_STATES.RECONNECTING;

      const delay = getBackoffDelay();
      await emitEvent("sync.reconnecting", { delay });

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        isDisconnecting = false;
        void connectRealtime();
      }, delay);
    } catch {
      isDisconnecting = false;
    }
  }

  function buildWebSocketUrl(baseUrl, token) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/sync/ws";
    url.searchParams.set("token", token);
    return url.toString();
  }

  async function connectRealtime() {
    if (connectionState === CONNECTION_STATES.CONNECTED || connectionState === CONNECTION_STATES.CONNECTING) {
      return;
    }

    const session = desktopSession.getDesktopSession();
    if (!session?.accessToken) {
      return;
    }

    connectionState = CONNECTION_STATES.CONNECTING;
    await emitEvent("sync.connecting");

    cleanupSubscription();

    try {
      const { baseUrl } = getRemoteConfig();
      const wsUrl = buildWebSocketUrl(baseUrl, session.accessToken);
      const socket = new WebSocket(wsUrl);
      currentSubscription = socket;

      socket.onopen = async () => {
        isDisconnecting = false;
        reconnectAttempts = 0;
        connectionState = CONNECTION_STATES.CONNECTED;
        await emitEvent("sync.connected");
      };

      socket.onmessage = (event) => {
        try {
          const payload = typeof event.data === "string" ? JSON.parse(event.data) : null;
          if (payload) {
            void handleRemoteChange(payload);
          }
        } catch {
          // no-op
        }
      };

      socket.onclose = () => {
        void handleDisconnect();
      };

      socket.onerror = () => {
        void handleDisconnect();
      };
    } catch (error) {
      desktopLog.appendDesktopLog("error.log", `sync realtime connect failure detail=${error.message}`);
      await handleDisconnect();
    }
  }

  async function startRealtime() {
    if (typeof WebSocket === "undefined") {
      return;
    }
    realtimeEnabled = true;
    await connectRealtime();
  }

  function stopRealtime() {
    realtimeEnabled = false;
    cleanupSubscription();
    connectionState = CONNECTION_STATES.IDLE;
  }

  return Object.freeze({
    startRealtime,
    stopRealtime,
    startRealtimeSyncListener: startRealtime,
    stopRealtimeSyncListener: stopRealtime
  });
}
