from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from app.core.config import settings

try:
    from redis import Redis
except Exception:  # noqa: BLE001
    Redis = None  # type: ignore[assignment]


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._events[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True


class RedisRateLimiter:
    def __init__(self, redis_url: str) -> None:
        if Redis is None:
            raise RuntimeError("redis package not installed.")
        self._redis = Redis.from_url(redis_url, decode_responses=True)
        self._redis.ping()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        namespaced_key = f"{settings.redis_key_prefix}:rate_limit:{key}"
        count = self._redis.incr(namespaced_key)
        if count == 1:
            self._redis.expire(namespaced_key, window_seconds)
        return count <= limit


class SafeRateLimiter:
    def __init__(self, redis_url: str | None) -> None:
        self._memory = InMemoryRateLimiter()
        self._redis: RedisRateLimiter | None = None
        production = settings.env.strip().lower() == "production"

        if production and not redis_url:
            raise RuntimeError("PHARMASYNC_REDIS_URL is required in production.")

        if redis_url:
            try:
                self._redis = RedisRateLimiter(redis_url)
            except Exception:  # noqa: BLE001
                if production:
                    raise RuntimeError("Redis is required and must be reachable in production.")
                self._redis = None

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        if self._redis is not None:
            try:
                return self._redis.allow(key, limit=limit, window_seconds=window_seconds)
            except Exception:  # noqa: BLE001
                pass
        return self._memory.allow(key, limit=limit, window_seconds=window_seconds)


rate_limiter = SafeRateLimiter(settings.redis_url)
