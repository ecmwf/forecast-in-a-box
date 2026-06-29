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
    await plugin_db.upsert_plugin_state(plugin_id="localTest:single", version="1.2.3", error=None)

    state = await plugin_db.get_plugin_state("localTest:single")
    assert state is not None
    assert state.plugin_id == "localTest:single"
    assert state.version == "1.2.3"
    assert state.error is None
    assert state.excluded_templates == []
    assert state.glyph_remapping == {}
    assert state.template_errors is None
    assert state.updated_at is not None


@pytest.mark.asyncio
async def test_upsert_updates_version_without_clobbering(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """Second upsert updates version/error but does not clobber excluded_templates / glyph_remapping."""
    await plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.1.0", error=None)

    # Simulate task-04/05 writes directly to DB
    from sqlalchemy import update as sa_update

    async with _jobs_module.async_session_maker() as session:
        await session.execute(
            sa_update(_jobs_module.PluginState)
            .where(_jobs_module.PluginState.plugin_id == "myStore:myPlugin")
            .values(excluded_templates=["tplA"], glyph_remapping={"old": "new"})
        )
        await session.commit()

    # Now re-install (update)
    await plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.2.0", error=None)

    state = await plugin_db.get_plugin_state("myStore:myPlugin")
    assert state is not None
    assert state.version == "0.2.0"
    assert state.error is None
    # excluded_templates / glyph_remapping must NOT be reset
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {"old": "new"}


@pytest.mark.asyncio
async def test_upsert_persists_install_error(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """An install failure writes the error string and records the attempt."""
    await plugin_db.upsert_plugin_state(plugin_id="bad:plugin", version=None, error="pip failed: some reason")

    state = await plugin_db.get_plugin_state("bad:plugin")
    assert state is not None
    assert state.error == "pip failed: some reason"
    assert state.version is None
    assert state.updated_at is not None


@pytest.mark.asyncio
async def test_get_all_plugin_states(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """get_all_plugin_states returns all persisted rows."""
    await plugin_db.upsert_plugin_state(plugin_id="storeA:p1", version="1.0", error=None)
    await plugin_db.upsert_plugin_state(plugin_id="storeA:p2", version=None, error="err")

    states = await plugin_db.get_all_plugin_states()
    ids = {s.plugin_id for s in states}
    assert ids == {"storeA:p1", "storeA:p2"}


@pytest.mark.asyncio
async def test_get_plugin_state_missing(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """get_plugin_state returns None for a plugin not yet installed."""
    state = await plugin_db.get_plugin_state("never:installed")
    assert state is None
