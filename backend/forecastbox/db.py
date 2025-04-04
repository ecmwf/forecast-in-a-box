"""
In-memory, thread-safe, mutation-robust simple KV store
"""

import pyrsistent
from typing import Generic, TypeVar, Protocol, Iterable, Optional

T = TypeVar("T")


class KVStore(Protocol[T]):
    def update(self, key: str, value: T):
        raise NotImplementedError

    def all(self) -> Iterable[tuple[str, T]]:
        raise NotImplementedError

    def get(self, key: str) -> Optional[T]:
        raise NotImplementedError

    def contains(self, key: str) -> bool:
        raise NotImplementedError

    def remove(self, key: str) -> None:
        raise NotImplementedError


class KVStorePyrsistent(Generic[T]):
    """Pyrsistent-based, lock-free implementation -- assuming assignment is atomic"""

    def __init__(self):
        self.d = pyrsistent.m()

    def update(self, key: str, value: T):
        # "new" collection constructed
        self.d = self.d.set(key, value)

    def all(self) -> Iterable[tuple[str, T]]:
        # iterator is immutable / won't see future updates
        return (e for e in self.d.items())

    def get(self, key: str) -> Optional[T]:
        return self.d.get(key, None)

    def contains(self, key: str) -> bool:
        return key in self.d

    def remove(self, key: str) -> None:
        self.d = self.d.remove(key)
