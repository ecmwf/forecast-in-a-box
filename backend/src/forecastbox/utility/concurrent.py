# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import os
import signal
import subprocess
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import Future
from contextlib import contextmanager
from multiprocessing.process import BaseProcess
from typing import Any, Iterator, cast

logger = logging.getLogger(__name__)


@contextmanager
def timed_acquire(lock: threading.Lock, timeout: float) -> Iterator[bool]:
    result = lock.acquire(timeout=timeout)
    try:
        yield result
    finally:
        if result:
            lock.release()


def delayed_thread(future: Future[Any], fn: Callable[..., Any], args: Sequence[Any] = ()) -> threading.Thread:
    """Return a thread that waits for `future` to complete, then calls `fn(*args)`.

    If the future raised an exception, a warning is logged and `fn` is called anyway
    so that the caller's own error handling can run.
    """

    def _target() -> None:
        try:
            future.result()
        except Exception as e:
            logger.warning(f"delayed_thread: future completed with error {repr(e)}, proceeding")
        fn(*args)

    return threading.Thread(target=_target)


class NoFreePortsException(Exception):
    """Raised when no ports are available in the FreePortsManager pool."""


# TODO utilize more across the codebase
class FreePortsManager:
    """Manages a pool of ports available for assignment to external processes."""

    # NOTE maybe a list would be better, and go cyclically -- should behave better wrt recyclation
    free_ports: set[int] = set(range(19000, 19100))
    lock: threading.Lock = threading.Lock()

    @staticmethod
    def claim_port() -> int:
        """Claim a free port from the pool. Raises NoFreePortsException if no ports are available."""
        # TODO some simple bind test here, loop and return
        with timed_acquire(FreePortsManager.lock, 1) as acquired:
            if not acquired:
                raise TimeoutError("FreePortsManager lock could not be acquired")
            if not FreePortsManager.free_ports:
                raise NoFreePortsException("No free ports available in the pool")
            return FreePortsManager.free_ports.pop()

    @staticmethod
    def release_port(port: int) -> None:
        """Return a port to the pool."""
        with timed_acquire(FreePortsManager.lock, 1) as acquired:
            if not acquired:
                raise TimeoutError("FreePortsManager lock could not be acquired")
            FreePortsManager.free_ports.add(port)


def shutdown_correctly(process: BaseProcess) -> None:
    """Gracefully shut down a multiprocessing BaseProcess: SIGINT -> terminate -> kill."""
    if process.is_alive():
        os.kill(cast(int, process.pid), signal.SIGINT)
        process.join(3)
    if process.is_alive():
        process.terminate()
        process.join(3)
    if process.is_alive():
        process.kill()
        process.join(3)


def shutdown_popen(process: subprocess.Popen[bytes]) -> None:
    """Gracefully shut down a subprocess.Popen (started with start_new_session=True): SIGINT group -> terminate -> kill."""
    if process.poll() is None:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGINT)
        except (ProcessLookupError, OSError):
            pass
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass
    if process.poll() is None:
        process.kill()
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass
