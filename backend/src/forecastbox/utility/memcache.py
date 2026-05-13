# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Backend-global size-limited in-memory cache."""

import sys
import threading
from collections.abc import Mapping, Sequence
from collections.abc import Set as AbstractSet
from typing import Any, TypeVar, cast

from pyrsistent import pmap
from pyrsistent.typing import PMap

T = TypeVar("T")


def _deep_sizeof(value: Any, seen: set[int] | None = None) -> int:
    if seen is None:
        seen = set()

    obj_id = id(value)
    if obj_id in seen:
        return 0
    seen.add(obj_id)

    size = sys.getsizeof(value)

    if isinstance(value, Mapping):
        for key, child in value.items():
            size += _deep_sizeof(key, seen)
            size += _deep_sizeof(child, seen)
        return size

    if isinstance(value, (str, bytes, bytearray, memoryview)):
        return size

    if isinstance(value, Sequence):
        for child in value:
            size += _deep_sizeof(child, seen)
        return size

    if isinstance(value, AbstractSet):
        for child in value:
            size += _deep_sizeof(child, seen)
        return size

    if hasattr(value, "__dict__"):
        size += _deep_sizeof(vars(value), seen)

    slots = getattr(type(value), "__slots__", ())
    if isinstance(slots, str):
        slots = (slots,)
    for slot in slots:
        if hasattr(value, slot):
            size += _deep_sizeof(getattr(value, slot), seen)

    return size


class _MemoryCache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.lookup: PMap[Any, Any] = pmap()
        self.sizes: PMap[Any, int] = pmap()
        self.lru: list[Any] = []
        self.max_size = 1024 * 1024 * 1024
        self.current_size = 0

    def _remove_key(self, key: Any) -> None:
        value_size = self.sizes.get(key)
        if value_size is not None:
            self.current_size -= value_size
            self.sizes = self.sizes.remove(key)
        self.lookup = self.lookup.remove(key)
        if key in self.lru:
            self.lru.remove(key)


_CACHE = _MemoryCache()


def insert(key: Any, value: Any) -> None:
    entry_size = _deep_sizeof((key, value))
    if entry_size > _CACHE.max_size:
        raise ValueError(f"value is too large for cache capacity: {entry_size} > {_CACHE.max_size}")

    with _CACHE.lock:
        if key in _CACHE.lookup:
            _CACHE._remove_key(key)

        while _CACHE.current_size + entry_size > _CACHE.max_size:
            if not _CACHE.lru:
                raise ValueError("cache eviction failed: no entries left but capacity is still exceeded")
            evict_key = _CACHE.lru[-1]
            _CACHE._remove_key(evict_key)

        _CACHE.lookup = _CACHE.lookup.set(key, value)
        _CACHE.sizes = _CACHE.sizes.set(key, entry_size)
        _CACHE.lru.insert(0, key)
        _CACHE.current_size += entry_size


def pop(key: Any) -> Any:
    with _CACHE.lock:
        value = _CACHE.lookup[key]
        _CACHE._remove_key(key)
        return value


def get(key: Any, value_type: type[T]) -> T:
    value = _CACHE.lookup[key]
    if not isinstance(value, value_type):
        raise TypeError(f"cache entry for {key!r} has type {type(value).__name__}, expected {value_type.__name__}")
    return cast(T, value)
