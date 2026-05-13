from typing import Any

import pytest

import forecastbox.utility.memcache as memcache


@pytest.fixture
def fresh_cache(monkeypatch: pytest.MonkeyPatch) -> memcache._MemoryCache:
    cache = memcache._MemoryCache()
    monkeypatch.setattr(memcache, "_CACHE", cache)
    return cache


def test_insert_get_roundtrip(fresh_cache: memcache._MemoryCache) -> None:
    payload = {"a": [1, 2, 3]}
    memcache.insert("k", payload)

    got = memcache.get("k", dict)
    assert got == payload
    assert fresh_cache.current_size > 0
    assert fresh_cache.lru == ["k"]


def test_get_type_mismatch_raises(fresh_cache: memcache._MemoryCache) -> None:
    del fresh_cache
    memcache.insert("k", {"a": 1})
    with pytest.raises(TypeError):
        memcache.get("k", list)


def test_pop_removes_entry(fresh_cache: memcache._MemoryCache) -> None:
    memcache.insert("k", [1, 2, 3])
    before = fresh_cache.current_size

    popped = memcache.pop("k")

    assert popped == [1, 2, 3]
    assert fresh_cache.current_size < before
    with pytest.raises(KeyError):
        memcache.get("k", list)
    assert fresh_cache.lru == []


def test_insert_evicts_lru_tail(fresh_cache: memcache._MemoryCache) -> None:
    v1: dict[str, Any] = {"payload": "A" * 2048}
    v2: dict[str, Any] = {"payload": "B" * 2048}
    s1 = memcache._deep_sizeof(("k1", v1))
    s2 = memcache._deep_sizeof(("k2", v2))
    fresh_cache.max_size = s1 + s2 - 1

    memcache.insert("k1", v1)
    memcache.insert("k2", v2)

    with pytest.raises(KeyError):
        memcache.get("k1", dict)
    assert memcache.get("k2", dict) == v2
    assert fresh_cache.lru == ["k2"]


def test_insert_rejects_oversized_value(fresh_cache: memcache._MemoryCache) -> None:
    fresh_cache.max_size = 1
    with pytest.raises(ValueError):
        memcache.insert("k", {"payload": "x" * 10})
