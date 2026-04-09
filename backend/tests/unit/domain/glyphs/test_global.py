# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/glyphs/global_db persistence layer."""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import forecastbox.domain.glyphs.global_db as global_glyph_db
from forecastbox.schemata.jobs import Base


@pytest_asyncio.fixture
async def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(global_glyph_db._jobs_module, "async_session_maker", maker)
    yield maker
    await engine.dispose()


# ---------------------------------------------------------------------------
# upsert_global_glyph
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_creates_new_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    row = await global_glyph_db.upsert_global_glyph("myKey", "myValue", "user1")
    assert row.key == "myKey"
    assert row.value == "myValue"
    assert row.created_by == "user1"
    assert row.global_glyph_id is not None


@pytest.mark.asyncio
async def test_upsert_updates_existing_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    row1 = await global_glyph_db.upsert_global_glyph("myKey", "initial", "user1")
    row2 = await global_glyph_db.upsert_global_glyph("myKey", "updated", "user2")
    assert row2.key == "myKey"
    assert row2.value == "updated"
    # id and created_by are preserved from the original insert
    assert str(row2.global_glyph_id) == str(row1.global_glyph_id)
    assert row2.created_by == "user1"


@pytest.mark.asyncio
async def test_upsert_different_keys_are_independent(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("keyA", "valA", None)
    await global_glyph_db.upsert_global_glyph("keyB", "valB", None)
    count = await global_glyph_db.count_global_glyphs()
    assert count == 2


# ---------------------------------------------------------------------------
# get_global_glyph
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_existing_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    created = await global_glyph_db.upsert_global_glyph("getKey", "getVal", "user1")
    fetched = await global_glyph_db.get_global_glyph(str(created.global_glyph_id))
    assert fetched is not None
    assert fetched.key == "getKey"
    assert fetched.value == "getVal"


@pytest.mark.asyncio
async def test_get_nonexistent_glyph_returns_none(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    result = await global_glyph_db.get_global_glyph("no-such-id")
    assert result is None


# ---------------------------------------------------------------------------
# list_global_glyphs / count_global_glyphs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_empty(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    rows = list(await global_glyph_db.list_global_glyphs())
    assert rows == []
    assert await global_glyph_db.count_global_glyphs() == 0


@pytest.mark.asyncio
async def test_list_ordered_by_key(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("zz", "v", None)
    await global_glyph_db.upsert_global_glyph("aa", "v", None)
    await global_glyph_db.upsert_global_glyph("mm", "v", None)
    rows = list(await global_glyph_db.list_global_glyphs())
    keys = [str(r.key) for r in rows]
    assert keys == ["aa", "mm", "zz"]


@pytest.mark.asyncio
async def test_list_pagination(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    for i in range(5):
        await global_glyph_db.upsert_global_glyph(f"key{i}", "v", None)
    page1 = list(await global_glyph_db.list_global_glyphs(offset=0, limit=2))
    page2 = list(await global_glyph_db.list_global_glyphs(offset=2, limit=2))
    page3 = list(await global_glyph_db.list_global_glyphs(offset=4, limit=2))
    assert len(page1) == 2
    assert len(page2) == 2
    assert len(page3) == 1
    all_keys = [str(r.key) for r in page1 + page2 + page3]
    assert sorted(all_keys) == all_keys


@pytest.mark.asyncio
async def test_count_reflects_upserts(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    assert await global_glyph_db.count_global_glyphs() == 0
    await global_glyph_db.upsert_global_glyph("k1", "v", None)
    assert await global_glyph_db.count_global_glyphs() == 1
    await global_glyph_db.upsert_global_glyph("k1", "v2", None)  # update, not new row
    assert await global_glyph_db.count_global_glyphs() == 1
    await global_glyph_db.upsert_global_glyph("k2", "v", None)
    assert await global_glyph_db.count_global_glyphs() == 2
