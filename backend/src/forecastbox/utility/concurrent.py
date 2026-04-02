# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import Future
from contextlib import contextmanager
from typing import Any, Iterator

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
