# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/plugin/db.py helpers.

Uses an in-memory SQLite engine (monkeypatching _jobs_module.async_session_maker)
so no filesystem state is required.
"""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import forecastbox.domain.plugin.db as plugin_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import Base


@pytest_asyncio.fixture
async def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "async_session_maker", maker)
    monkeypatch.setattr(plugin_db._jobs_module, "async_session_maker", maker)
    yield maker
    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_creates_row_with_defaults(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """First upsert inserts a row with empty excluded_templates and glyph_remapping."""
    await plugin_db.upsert_plugin_state(plugin_id="localTest:single", version="1.2.3", enabled=True, install_error=None)

    state = await plugin_db.get_plugin_state("localTest:single")
    assert state is not None
    assert state.plugin_id == "localTest:single"
    assert state.plugin_version == "1.2.3"
    assert state.install_error is None
    assert state.excluded_templates == []
    assert state.glyph_remapping == {}
    assert state.template_errors is None
    assert state.updated_at is not None
    assert state.asset_ingest_needed is True
    assert state.enabled is True


@pytest.mark.asyncio
async def test_upsert_updates_version_without_clobbering(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Second upsert updates plugin_version/install_error but does not clobber excluded_templates / glyph_remapping."""
    await plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.1.0", enabled=True, install_error=None)

    # Simulate writes by later subsystems directly to DB
    from sqlalchemy import update as sa_update

    async with _jobs_module.async_session_maker() as session:
        await session.execute(
            sa_update(_jobs_module.PluginState)
            .where(_jobs_module.PluginState.plugin_id == "myStore:myPlugin")
            .values(excluded_templates=["tplA"], glyph_remapping={"old": "new"})
        )
        await session.commit()

    # Re-install (update) -- new version triggers asset_ingest_needed=True
    await plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.2.0", enabled=True, install_error=None)

    state = await plugin_db.get_plugin_state("myStore:myPlugin")
    assert state is not None
    assert state.plugin_version == "0.2.0"
    assert state.install_error is None
    # excluded_templates / glyph_remapping must NOT be reset
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {"old": "new"}
    assert state.asset_ingest_needed is True


@pytest.mark.asyncio
async def test_upsert_no_version_change_does_not_set_ingest(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """When version is unchanged, asset_ingest_needed is not set again once cleared."""
    await plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0.0", enabled=True, install_error=None)
    await plugin_db.clear_asset_ingest_needed(plugin_id="s:p")

    await plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0.0", enabled=True, install_error=None)

    state = await plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.asset_ingest_needed is False


@pytest.mark.asyncio
async def test_upsert_reenable_sets_ingest(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Re-enabling a disabled plugin sets asset_ingest_needed=True."""
    await plugin_db.upsert_plugin_state(plugin_id="s:q", version="1.0.0", enabled=True)
    await plugin_db.clear_asset_ingest_needed(plugin_id="s:q")
    await plugin_db.upsert_plugin_state(plugin_id="s:q", enabled=False)

    await plugin_db.upsert_plugin_state(plugin_id="s:q", enabled=True)

    state = await plugin_db.get_plugin_state("s:q")
    assert state is not None
    assert state.enabled is True
    assert state.asset_ingest_needed is True


@pytest.mark.asyncio
async def test_upsert_none_version_on_missing_row_raises(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """upsert_plugin_state with version=None and no existing row is a programming error."""
    with pytest.raises(RuntimeError, match="no prior DB row"):
        await plugin_db.upsert_plugin_state(plugin_id="never:seen", version=None, enabled=True, install_error=None)


@pytest.mark.asyncio
async def test_upsert_persists_install_error(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """An install failure writes the error string and records the attempt."""
    await plugin_db.upsert_plugin_state(plugin_id="bad:plugin", version="unknown", enabled=True, install_error="pip failed: some reason")

    state = await plugin_db.get_plugin_state("bad:plugin")
    assert state is not None
    assert state.install_error == "pip failed: some reason"
    assert state.plugin_version == "unknown"
    assert state.updated_at is not None


@pytest.mark.asyncio
async def test_get_all_plugin_states(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """get_all_plugin_states returns all persisted rows."""
    await plugin_db.upsert_plugin_state(plugin_id="storeA:p1", version="1.0", enabled=True, install_error=None)
    await plugin_db.upsert_plugin_state(plugin_id="storeA:p2", version="unknown", enabled=True, install_error="err")

    states = await plugin_db.get_all_plugin_states()
    ids = {s.plugin_id for s in states}
    assert ids == {"storeA:p1", "storeA:p2"}


@pytest.mark.asyncio
async def test_get_plugin_state_missing(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """get_plugin_state returns None for a plugin not yet installed."""
    state = await plugin_db.get_plugin_state("never:installed")
    assert state is None


@pytest.mark.asyncio
async def test_update_plugin_settings_partial_excluded(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """update_plugin_settings overwrites excluded_templates when provided, leaves glyph_remapping unchanged."""
    await plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0", enabled=True, install_error=None)
    await plugin_db.update_plugin_settings(plugin_id="s:p", excluded_templates=["tplA"], glyph_remapping=None)

    state = await plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {}

    await plugin_db.update_plugin_settings(plugin_id="s:p", excluded_templates=None, glyph_remapping={"old": "new"})
    state = await plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {"old": "new"}


@pytest.mark.asyncio
async def test_update_plugin_settings_empty_list_clears(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Passing an empty list for excluded_templates explicitly clears the stored list."""
    await plugin_db.upsert_plugin_state(plugin_id="s:q", version="1.0", enabled=True, install_error=None)
    await plugin_db.update_plugin_settings(plugin_id="s:q", excluded_templates=["x", "y"], glyph_remapping=None)
    await plugin_db.update_plugin_settings(plugin_id="s:q", excluded_templates=[], glyph_remapping=None)

    state = await plugin_db.get_plugin_state("s:q")
    assert state is not None
    assert state.excluded_templates == []


@pytest.mark.asyncio
async def test_update_plugin_settings_raises_if_missing(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """update_plugin_settings raises RuntimeError when no PluginState row exists yet."""
    with pytest.raises(RuntimeError, match="not installed"):
        await plugin_db.update_plugin_settings(plugin_id="new:plugin", excluded_templates=["tplX"], glyph_remapping=None)
