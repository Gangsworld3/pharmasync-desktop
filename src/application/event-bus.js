import { metrics } from "./metrics.js";

function asErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  return typeof error.message === "string" ? error.message : String(error);
}

function isTimeoutError(error) {
  return asErrorMessage(error) === "event.timeout";
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("event.timeout")), ms)
    )
  ]);
}

function asPromise(result) {
  return result instanceof Promise ? result : Promise.resolve(result);
}

function buildLogger(logger) {
  if (!logger) {
    return {
      warn: () => {},
      error: () => {},
      info: () => {}
    };
  }

  if (typeof logger === "function") {
    return {
      info: (eventName, payload = {}) => {
        logger("desktop-events.log", { event: eventName, ...payload });
      },
      warn: (eventName, payload = {}) => {
        logger("desktop-events.log", { event: eventName, ...payload });
      },
      error: (eventName, payload = {}) => {
        logger("desktop-events.log", { event: eventName, ...payload });
      }
    };
  }

  return {
    info: typeof logger.info === "function" ? logger.info.bind(logger) : () => {},
    warn: typeof logger.warn === "function" ? logger.warn.bind(logger) : () => {},
    error: typeof logger.error === "function" ? logger.error.bind(logger) : () => {}
  };
}

export function createEventBus({ logger, defaultTimeoutMs = 5000, asyncDispatch = true } = {}) {
  const subscribersByEvent = new Map();
  const ruleHooks = new Set();
  const log = buildLogger(logger);
  let dispatchQueue = Promise.resolve();

  function subscribe(eventName, handler) {
    if (!subscribersByEvent.has(eventName)) {
      subscribersByEvent.set(eventName, new Set());
    }
    const handlers = subscribersByEvent.get(eventName);
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        subscribersByEvent.delete(eventName);
      }
    };
  }

  function registerRuleHook(hook) {
    ruleHooks.add(hook);
    return () => {
      ruleHooks.delete(hook);
    };
  }

  async function runHookSafely(ruleHook, eventEnvelope, timeoutMs) {
    try {
      await withTimeout(asPromise(ruleHook(eventEnvelope)), timeoutMs);
    } catch (error) {
      if (isTimeoutError(error)) {
        metrics.increment("event.handler.timeout");
        log.warn("event.handler.timeout", { eventName: eventEnvelope.name });
      }
      metrics.increment("event.handler.failure");
      log.error("event.handler.failed", {
        eventName: eventEnvelope.name,
        error: asErrorMessage(error)
      });
    }
  }

  async function runHandlerSafely(handler, eventEnvelope, timeoutMs) {
    try {
      await withTimeout(asPromise(handler(eventEnvelope)), timeoutMs);
      metrics.increment("event.handler.success");
      return { status: "fulfilled" };
    } catch (error) {
      if (isTimeoutError(error)) {
        metrics.increment("event.handler.timeout");
        log.warn("event.handler.timeout", { eventName: eventEnvelope.name });
      }
      metrics.increment("event.handler.failure");
      log.error("event.handler.failed", {
        eventName: eventEnvelope.name,
        error: asErrorMessage(error)
      });
      return { status: "rejected", reason: error };
    }
  }

  async function runDispatch(eventEnvelope, { sync = false, timeoutMs } = {}) {
    const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : defaultTimeoutMs;
    metrics.increment("event.emitted");

    log.info("event.emitted", {
      eventName: eventEnvelope.name,
      at: eventEnvelope.at,
      ...eventEnvelope.payload
    });

    const hooks = Array.from(ruleHooks);
    if (sync) {
      for (const ruleHook of hooks) {
        await runHookSafely(ruleHook, eventEnvelope, effectiveTimeout);
      }
    } else {
      await Promise.allSettled(hooks.map((ruleHook) => runHookSafely(ruleHook, eventEnvelope, effectiveTimeout)));
    }

    const handlers = Array.from(subscribersByEvent.get(eventEnvelope.name) ?? []);
    if (handlers.length === 0) {
      return;
    }

    if (sync) {
      for (const handler of handlers) {
        await runHandlerSafely(handler, eventEnvelope, effectiveTimeout);
      }
      return;
    }

    await Promise.allSettled(
      handlers.map((handler) => runHandlerSafely(handler, eventEnvelope, effectiveTimeout))
    );
  }

  async function emit(eventName, payload = {}, options = {}) {
    const eventEnvelope = {
      name: eventName,
      at: new Date().toISOString(),
      payload
    };

    const run = () => runDispatch(eventEnvelope, options).catch((error) => {
      log.error("event.dispatch.failed", {
        eventName,
        error: asErrorMessage(error)
      });
    });

    const shouldQueue = asyncDispatch && options.sync !== true;
    if (!shouldQueue) {
      await run();
      return;
    }

    dispatchQueue = dispatchQueue
      .then(run)
      .catch((error) => {
        log.error("event.queue.failed", {
          eventName,
          error: asErrorMessage(error)
        });
      });

    await dispatchQueue;
  }

  return Object.freeze({
    emit,
    subscribe,
    registerRuleHook
  });
}
