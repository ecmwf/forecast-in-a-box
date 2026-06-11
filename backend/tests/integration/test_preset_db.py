# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for preset database operations."""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from forecastbox.domain.preset import db as preset_db
from forecastbox.domain.preset.types import PresetId
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext


@pytest_asyncio.fixture(autouse=True)
async def in_memory_db(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[None, None]:
    """Patch the jobs module session maker to use a fresh in-memory SQLite DB.

    Each test gets its own isolated database so tests do not interfere with
    each other or with the on-disk job database.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(preset_db._jobs_module, "async_session_maker", session_maker)
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_list_presets_empty() -> None:
    """Test list_presets returns empty list when no presets exist."""
    result = await preset_db.list_presets()
    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_list_presets_with_filters() -> None:
    """Test list_presets with various filters."""
    # Create a test preset
    auth_context = AuthContext(user_id="test_user", is_admin=True)

    preset_id, version = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Test Preset",
        description="A test preset for filtering",
        difficulty="beginner",
        tags=["test", "example"],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )

    # Test list all published presets
    result = await preset_db.list_presets(published_only=True)
    assert len(result) >= 1
    assert any(p.preset_id == preset_id for p in result)

    # Test difficulty filter
    result = await preset_db.list_presets(difficulty="beginner")
    assert len(result) >= 1
    assert all(p.difficulty == "beginner" for p in result)

    # Test search filter (case-insensitive)
    result = await preset_db.list_presets(search="TEST")
    assert len(result) >= 1

    # Test pagination
    result = await preset_db.list_presets(offset=0, limit=1)
    assert len(result) <= 1


@pytest.mark.asyncio
async def test_count_presets() -> None:
    """Test count_presets returns correct count."""
    # Create a test preset
    auth_context = AuthContext(user_id="test_user", is_admin=True)

    preset_id, version = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Count Test Preset",
        description="A test preset for counting",
        difficulty="intermediate",
        tags=["count"],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )

    # Test count all published presets
    count = await preset_db.count_presets(published_only=True)
    assert count >= 1

    # Test count with difficulty filter
    count = await preset_db.count_presets(difficulty="intermediate")
    assert count >= 1

    # Test count with search filter
    count = await preset_db.count_presets(search="count")
    assert count >= 1


@pytest.mark.asyncio
async def test_list_presets_published_only() -> None:
    """Test that published_only filter works correctly."""
    auth_context = AuthContext(user_id="test_user", is_admin=True)

    # Create a published preset
    published_id, _ = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Published Preset",
        description="This is published",
        difficulty="beginner",
        tags=[],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )

    # Create an unpublished preset
    unpublished_id, _ = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Unpublished Preset",
        description="This is not published",
        difficulty="beginner",
        tags=[],
        builder_template={"blocks": {}},
        is_published=False,
        created_by="test_user",
    )

    # Test published_only=True (default)
    published_presets = await preset_db.list_presets(published_only=True)
    published_ids = [p.preset_id for p in published_presets]
    assert published_id in published_ids
    assert unpublished_id not in published_ids

    # Test published_only=False
    all_presets = await preset_db.list_presets(published_only=False)
    all_ids = [p.preset_id for p in all_presets]
    assert published_id in all_ids
    assert unpublished_id in all_ids


@pytest.mark.asyncio
async def test_search_in_tags() -> None:
    """Test that search filter matches tags."""
    auth_context = AuthContext(user_id="test_user", is_admin=True)

    # Create a preset with specific tags
    preset_id, _ = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Tagged Preset",
        description="A preset with tags",
        difficulty="beginner",
        tags=["featured", "quickstart", "example"],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )

    # Search for a tag
    result = await preset_db.list_presets(search="featured")
    assert len(result) >= 1
    assert any(p.preset_id == preset_id for p in result)

    # Search for another tag (case-insensitive)
    result = await preset_db.list_presets(search="QUICKSTART")
    assert len(result) >= 1
    assert any(p.preset_id == preset_id for p in result)


@pytest.mark.asyncio
async def test_patch_preset_publish_status_does_not_increment_version() -> None:
    """patch_preset_publish_status updates is_published in place without creating a new version."""
    auth_context = AuthContext(user_id="test_user", is_admin=True)

    preset_id, version = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Publish Toggle Test",
        description="A preset for publish toggle testing",
        difficulty="beginner",
        tags=[],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )
    assert version == 1

    # Unpublish in place — version must stay at 1.
    await preset_db.patch_preset_publish_status(
        preset_id,
        is_published=False,
        expected_version=version,
        auth_context=auth_context,
    )

    row = await preset_db.get_preset(preset_id)
    assert row is not None
    assert row.version == 1, "Version must not be incremented by a publish toggle"
    assert row.is_published is False

    # Re-publish in place — version must still be 1.
    await preset_db.patch_preset_publish_status(
        preset_id,
        is_published=True,
        expected_version=1,
        auth_context=auth_context,
    )

    row = await preset_db.get_preset(preset_id)
    assert row is not None
    assert row.version == 1
    assert row.is_published is True


@pytest.mark.asyncio
async def test_patch_preset_publish_status_version_conflict() -> None:
    """patch_preset_publish_status raises PresetVersionConflict on stale version."""
    from forecastbox.domain.preset.exceptions import PresetVersionConflict

    auth_context = AuthContext(user_id="test_user", is_admin=True)

    preset_id, version = await preset_db.insert_preset(
        auth_context=auth_context,
        name="Version Conflict Publish Test",
        description="desc",
        difficulty="beginner",
        tags=[],
        builder_template={"blocks": {}},
        is_published=True,
        created_by="test_user",
    )

    with pytest.raises(PresetVersionConflict):
        await preset_db.patch_preset_publish_status(
            preset_id,
            is_published=False,
            expected_version=999,  # stale
            auth_context=auth_context,
        )


@pytest.mark.asyncio
async def test_patch_preset_publish_status_not_found() -> None:
    """patch_preset_publish_status raises PresetNotFound for unknown preset_id."""
    from forecastbox.domain.preset.exceptions import PresetNotFound
    from forecastbox.domain.preset.types import PresetId

    auth_context = AuthContext(user_id="test_user", is_admin=True)

    with pytest.raises(PresetNotFound):
        await preset_db.patch_preset_publish_status(
            PresetId("does-not-exist"),
            is_published=False,
            expected_version=1,
            auth_context=auth_context,
        )
