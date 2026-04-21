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
from forecastbox.domain.glyphs.global_db import GlyphResolutionBuckets
from forecastbox.domain.glyphs.types import GlobalGlyphId
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext

_user1 = AuthContext(user_id="user1", is_admin=False)
_user2 = AuthContext(user_id="user2", is_admin=False)
_admin = AuthContext(user_id="admin", is_admin=True)


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
    row = await global_glyph_db.upsert_global_glyph("myKey", "myValue", False, None, _user1)
    assert row.key == "myKey"
    assert row.value == "myValue"
    assert row.public is False
    assert row.overriddable is None
    assert row.created_by == "user1"
    assert row.global_glyph_id is not None


@pytest.mark.asyncio
async def test_upsert_creates_public_overriddable_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    row = await global_glyph_db.upsert_global_glyph("pubKey", "pubVal", True, True, _admin)
    assert row.public is True
    assert row.overriddable is True


@pytest.mark.asyncio
async def test_upsert_creates_public_nonoverridable_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    row = await global_glyph_db.upsert_global_glyph("pubKey", "pubVal", True, False, _admin)
    assert row.public is True
    assert row.overriddable is False


@pytest.mark.asyncio
async def test_upsert_owner_can_update(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    row1 = await global_glyph_db.upsert_global_glyph("myKey", "initial", False, None, _user1)
    row2 = await global_glyph_db.upsert_global_glyph("myKey", "updated", False, None, _user1)
    assert row2.value == "updated"
    assert str(row2.global_glyph_id) == str(row1.global_glyph_id)
    assert row2.created_by == "user1"


@pytest.mark.asyncio
async def test_upsert_different_users_same_key_creates_separate_rows(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Two different users can each have a private glyph with the same key name."""
    row1 = await global_glyph_db.upsert_global_glyph("myKey", "val1", False, None, _user1)
    row2 = await global_glyph_db.upsert_global_glyph("myKey", "val2", False, None, _user2)
    assert str(row1.global_glyph_id) != str(row2.global_glyph_id)
    assert row1.value == "val1"
    assert row2.value == "val2"
    assert await global_glyph_db.count_global_glyphs(_admin) == 2


@pytest.mark.asyncio
async def test_upsert_different_keys_are_independent(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("keyA", "valA", False, None, _admin)
    await global_glyph_db.upsert_global_glyph("keyB", "valB", False, None, _admin)
    count = await global_glyph_db.count_global_glyphs(_admin)
    assert count == 2


# ---------------------------------------------------------------------------
# get_global_glyph — visibility
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_own_private_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    created = await global_glyph_db.upsert_global_glyph("getKey", "getVal", False, None, _user1)
    fetched = await global_glyph_db.get_global_glyph(GlobalGlyphId(str(created.global_glyph_id)), _user1)
    assert fetched is not None
    assert fetched.key == "getKey"


@pytest.mark.asyncio
async def test_get_public_glyph_by_other_user(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """user2 can get a public glyph owned by admin."""
    created = await global_glyph_db.upsert_global_glyph("pubKey", "pubVal", True, True, _admin)
    fetched = await global_glyph_db.get_global_glyph(GlobalGlyphId(str(created.global_glyph_id)), _user2)
    assert fetched is not None


@pytest.mark.asyncio
async def test_get_private_glyph_invisible_to_other_user(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """user2 cannot get a private glyph owned by user1."""
    created = await global_glyph_db.upsert_global_glyph("privKey", "privVal", False, None, _user1)
    fetched = await global_glyph_db.get_global_glyph(GlobalGlyphId(str(created.global_glyph_id)), _user2)
    assert fetched is None


@pytest.mark.asyncio
async def test_get_admin_sees_private_glyph(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    created = await global_glyph_db.upsert_global_glyph("privKey", "privVal", False, None, _user1)
    fetched = await global_glyph_db.get_global_glyph(GlobalGlyphId(str(created.global_glyph_id)), _admin)
    assert fetched is not None


@pytest.mark.asyncio
async def test_get_nonexistent_glyph_returns_none(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    result = await global_glyph_db.get_global_glyph(GlobalGlyphId("no-such-id"), _admin)
    assert result is None


# ---------------------------------------------------------------------------
# list_global_glyphs / count_global_glyphs — visibility
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_empty(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    rows = list(await global_glyph_db.list_global_glyphs(_admin))
    assert rows == []
    assert await global_glyph_db.count_global_glyphs(_admin) == 0


@pytest.mark.asyncio
async def test_list_user_sees_own_and_public(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """user1 sees their private glyph and admin's public glyph, but not user2's private glyph."""
    await global_glyph_db.upsert_global_glyph("u1priv", "v", False, None, _user1)
    await global_glyph_db.upsert_global_glyph("adminpub", "v", True, True, _admin)
    await global_glyph_db.upsert_global_glyph("u2priv", "v", False, None, _user2)

    rows = list(await global_glyph_db.list_global_glyphs(_user1))
    keys = {str(r.key) for r in rows}
    assert "u1priv" in keys
    assert "adminpub" in keys
    assert "u2priv" not in keys
    assert await global_glyph_db.count_global_glyphs(_user1) == 2


@pytest.mark.asyncio
async def test_list_admin_sees_all(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("u1priv", "v", False, None, _user1)
    await global_glyph_db.upsert_global_glyph("adminpub", "v", True, True, _admin)
    await global_glyph_db.upsert_global_glyph("u2priv", "v", False, None, _user2)

    rows = list(await global_glyph_db.list_global_glyphs(_admin))
    assert len(rows) == 3
    assert await global_glyph_db.count_global_glyphs(_admin) == 3


@pytest.mark.asyncio
async def test_list_ordered_by_key(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("zz", "v", False, None, _admin)
    await global_glyph_db.upsert_global_glyph("aa", "v", False, None, _admin)
    await global_glyph_db.upsert_global_glyph("mm", "v", False, None, _admin)
    rows = list(await global_glyph_db.list_global_glyphs(_admin))
    keys = [str(r.key) for r in rows]
    assert keys == ["aa", "mm", "zz"]


@pytest.mark.asyncio
async def test_list_pagination(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    for i in range(5):
        await global_glyph_db.upsert_global_glyph(f"key{i}", "v", False, None, _admin)
    page1 = list(await global_glyph_db.list_global_glyphs(_admin, offset=0, limit=2))
    page2 = list(await global_glyph_db.list_global_glyphs(_admin, offset=2, limit=2))
    page3 = list(await global_glyph_db.list_global_glyphs(_admin, offset=4, limit=2))
    assert len(page1) == 2
    assert len(page2) == 2
    assert len(page3) == 1
    all_keys = [str(r.key) for r in page1 + page2 + page3]
    assert sorted(all_keys) == all_keys


@pytest.mark.asyncio
async def test_count_reflects_upserts(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    assert await global_glyph_db.count_global_glyphs(_admin) == 0
    await global_glyph_db.upsert_global_glyph("k1", "v", False, None, _user1)
    assert await global_glyph_db.count_global_glyphs(_admin) == 1
    await global_glyph_db.upsert_global_glyph("k1", "v2", False, None, _user1)  # update, not new row
    assert await global_glyph_db.count_global_glyphs(_admin) == 1
    await global_glyph_db.upsert_global_glyph("k2", "v", False, None, _user1)
    assert await global_glyph_db.count_global_glyphs(_admin) == 2


# ---------------------------------------------------------------------------
# get_glyphs_for_resolution — three-tier ordering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolution_empty(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets == GlyphResolutionBuckets(public_overriddable={}, user_own={}, public_nonoverridable={})


@pytest.mark.asyncio
async def test_resolution_user_sees_own_private(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("myKey", "myVal", False, None, _user1)
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets.user_own == {"myKey": "myVal"}
    assert buckets.public_overriddable == {}
    assert buckets.public_nonoverridable == {}


@pytest.mark.asyncio
async def test_resolution_public_overriddable_and_nonoverridable(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    await global_glyph_db.upsert_global_glyph("soft", "soft_val", True, True, _admin)
    await global_glyph_db.upsert_global_glyph("hard", "hard_val", True, False, _admin)
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets.public_overriddable == {"soft": "soft_val"}
    assert buckets.public_nonoverridable == {"hard": "hard_val"}
    assert buckets.user_own == {}


@pytest.mark.asyncio
async def test_resolution_user_private_glyph_not_visible_to_other_user(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """user2's private glyphs must not appear in user1's resolution buckets."""
    await global_glyph_db.upsert_global_glyph("sharedKey", "user2_val", False, None, _user2)
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets.user_own == {}


@pytest.mark.asyncio
async def test_resolution_same_key_different_users(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Each user gets only their own value in user_own; public goes to the right tier."""
    await global_glyph_db.upsert_global_glyph("key", "admin_soft", True, True, _admin)
    await global_glyph_db.upsert_global_glyph("key", "user1_val", False, None, _user1)
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets.public_overriddable == {"key": "admin_soft"}
    assert buckets.user_own == {"key": "user1_val"}
    assert buckets.public_nonoverridable == {}


@pytest.mark.asyncio
async def test_resolution_tie_break_by_updated_at(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """When two public glyphs have the same key, the most recently updated one wins."""
    await global_glyph_db.upsert_global_glyph("contested", "old_val", True, True, _admin)
    admin2 = AuthContext(user_id="admin2", is_admin=True)
    await global_glyph_db.upsert_global_glyph("contested", "newer_val", True, True, admin2)
    buckets = await global_glyph_db.get_glyphs_for_resolution(_user1)
    assert buckets.public_overriddable["contested"] == "newer_val"
