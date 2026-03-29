from __future__ import annotations

import logging
from queue import Empty, Queue
from threading import Event, Thread
from typing import Any, Callable

logger = logging.getLogger("pharmasync.background")


class BackgroundDispatcher:
    def __init__(self) -> None:
        self._queue: Queue[tuple[Callable[..., Any], tuple[Any, ...], dict[str, Any]]] = Queue()
        self._stop = Event()
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._run, name="pharmasync-background", daemon=True)
        self._thread.start()

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        self._queue.put((fn, args, kwargs))

    def stop(self, timeout_seconds: float = 2.0) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout_seconds)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                fn, args, kwargs = self._queue.get(timeout=0.2)
            except Empty:
                continue
            try:
                fn(*args, **kwargs)
            except Exception:  # noqa: BLE001
                logger.exception("background_task_failed")


dispatcher = BackgroundDispatcher()
