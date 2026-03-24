# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# TODO move to ecpyutil once that is published

import dataclasses
import logging
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import Future
from contextlib import contextmanager
from typing import Any, Iterator, TypeVar

_T = TypeVar("_T")


@contextmanager
def timed_acquire(lock: threading.Lock, timeout: float) -> Iterator[bool]:
    result = lock.acquire(timeout=timeout)
    try:
        yield result
    finally:
        if result:
            lock.release()


def frozendc(cls: type[_T]) -> type[_T]:
    """Frozen dataclass decorator that creates immutable, slotted dataclasses.

    This is a convenience wrapper for @dataclass(frozen=True, eq=True, slots=True).
    Use this for data transfer objects and value types that should be immutable and
    memory-efficient. Benefits: thread-safe, hashable (can be dict keys), prevents
    accidental mutation, reduced memory footprint via slots. Only use on classes
    without inheritance and that don't need post-init mutation.

    Note: Type checkers may not fully understand this decorator. Don't use it yet.
    We also tried a pyi stub, but `ty` isn't ready.
    """
    return dataclasses.dataclass(frozen=True, eq=True, slots=True)(cls)  # type: ignore[return-value]


def deep_union(dict1: dict[str, Any], dict2: dict[str, Any]) -> dict[str, Any]:
    """Recursively merges two dictionaries. In case of conflicts, values from dict2 are preferred. Copies the first."""
    merged = dict1.copy()
    for key, value in dict2.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_union(merged[key], value)
        else:
            merged[key] = value
    return merged


_logger = logging.getLogger(__name__)


def delayed_thread(future: Future[Any], fn: Callable[..., Any], args: Sequence[Any] = ()) -> threading.Thread:
    """Return a thread that waits for `future` to complete, then calls `fn(*args)`.

    If the future raised an exception, a warning is logged and `fn` is called anyway
    so that the caller's own error handling can run.
    """

    def _target() -> None:
        try:
            future.result()
        except Exception as e:
            _logger.warning(f"delayed_thread: future completed with error {repr(e)}, proceeding")
        fn(*args)

    return threading.Thread(target=_target)
