from forecastbox.db import KVStorePyrsistent, T, KVStore
from typing import Iterable, Generic, Optional
import pytest


class KVStoreUnsafe(Generic[T]):
	def __init__(self):
		self.d = {}

	def update(self, key: str, value: T):
		self.d[key] = value

	def all(self) -> Iterable[tuple[str, T]]:
		return (e for e in self.d.items())

	def get(self, key: str) -> Optional[T]:
		return self.d.get(key, None)


def example_run(kvStore: KVStore[int]) -> tuple[Iterable[tuple[str, int]], Optional[int]]:
	kvStore.update("a", 7)
	kvStore.update("b", 9)
	iter1 = kvStore.all()
	kvStore.update("a", 4)
	kvStore.update("c", 6)
	return iter1, kvStore.get("a")


def test_db_consistency():
	db1 = KVStorePyrsistent()
	rv1 = example_run(db1)
	assert sorted(list(rv1[0])) == sorted([("a", 7), ("b", 9)])
	assert rv1[1] == 4

	db2 = KVStoreUnsafe()
	rv2 = example_run(db2)

	with pytest.raises(RuntimeError, match="dictionary changed size during iteration"):
		# NOTE even if it didnt raise, it would have shown the update to 'a'
		assert sorted(list(rv2[0])) == sorted([("a", 7), ("b", 9)])
		assert rv2[1] == 4
