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
import threading
from contextlib import contextmanager
from typing import Iterator, TypeVar

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
    
    Note: Type checkers may not fully understand this decorator. If you get type errors
    at usage sites, add `# ty: ignore` comment after the decorator.
    """
    return dataclasses.dataclass(frozen=True, eq=True, slots=True)(cls)  # type: ignore[return-value]
