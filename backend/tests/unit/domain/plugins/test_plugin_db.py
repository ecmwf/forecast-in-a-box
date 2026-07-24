# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/plugin/db.py helpers.

Uses an in-memory SQLite engine (monkeypatching _jobs_module.session_maker)
so no filesystem state is required.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.plugin.db as plugin_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.plugin.errors import PluginError
from forecastbox.domain.plugin.exceptions import PluginNotFound
from forecastbox.schemata.jobs import Base


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Iterator[sessionmaker[Session]]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "session_maker", maker)
    monkeypatch.setattr(plugin_db._jobs_module, "session_maker", maker)
    yield maker
    engine.dispose()


@pytest.mark.asyncio
async def test_upsert_creates_row_with_defaults(mem_session_maker: sessionmaker[Session]) -> None:
    """First upsert inserts a row with empty excluded_templates and glyph_remapping."""
    plugin_db.upsert_plugin_state(plugin_id="localTest:single", version="1.2.3", enabled=True)

    state = plugin_db.get_plugin_state("localTest:single")
    assert state is not None
    assert state.plugin_id == "localTest:single"
    assert state.plugin_version == "1.2.3"
    assert state.plugin_errors == []
    assert state.excluded_templates == []
    assert state.glyph_remapping == {}
    assert state.template_errors == {}
    assert state.updated_at is not None
    assert state.asset_ingest_needed is True
    assert state.enabled is True


@pytest.mark.asyncio
async def test_upsert_updates_version_without_clobbering(mem_session_maker: sessionmaker[Session]) -> None:
    """Second upsert updates plugin_version/plugin_errors but does not clobber excluded_templates / glyph_remapping."""
    plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.1.0", enabled=True)

    # Simulate writes by later subsystems directly to DB
    from sqlalchemy import update as sa_update

    with _jobs_module.session_maker() as session:
        session.execute(
            sa_update(_jobs_module.PluginState)
            .where(_jobs_module.PluginState.plugin_id == "myStore:myPlugin")
            .values(excluded_templates=["tplA"], glyph_remapping={"old": "new"})
        )
        session.commit()

    # Re-install (update) -- new version triggers asset_ingest_needed=True
    plugin_db.upsert_plugin_state(plugin_id="myStore:myPlugin", version="0.2.0", plugin_errors=[])

    state = plugin_db.get_plugin_state("myStore:myPlugin")
    assert state is not None
    assert state.plugin_version == "0.2.0"
    assert state.plugin_errors == []
    # excluded_templates / glyph_remapping must NOT be reset
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {"old": "new"}
    assert state.asset_ingest_needed is True


@pytest.mark.asyncio
async def test_upsert_no_version_change_does_not_set_ingest(mem_session_maker: sessionmaker[Session]) -> None:
    """When version is unchanged, asset_ingest_needed is not set again once cleared."""
    plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0.0", enabled=True)
    plugin_db.clear_asset_ingest_needed(plugin_id="s:p")

    plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0.0", enabled=True)

    state = plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.asset_ingest_needed is False


@pytest.mark.asyncio
async def test_upsert_reenable_sets_ingest(mem_session_maker: sessionmaker[Session]) -> None:
    """Re-enabling a disabled plugin sets asset_ingest_needed=True."""
    plugin_db.upsert_plugin_state(plugin_id="s:q", version="1.0.0", enabled=True)
    plugin_db.clear_asset_ingest_needed(plugin_id="s:q")
    plugin_db.upsert_plugin_state(plugin_id="s:q", enabled=False)

    plugin_db.upsert_plugin_state(plugin_id="s:q", enabled=True)

    state = plugin_db.get_plugin_state("s:q")
    assert state is not None
    assert state.enabled is True
    assert state.asset_ingest_needed is True


@pytest.mark.asyncio
async def test_upsert_none_version_on_missing_row_raises(mem_session_maker: sessionmaker[Session]) -> None:
    """upsert_plugin_state with version=None and no existing row is a programming error."""
    with pytest.raises(PluginNotFound):
        plugin_db.upsert_plugin_state(plugin_id="never:seen", version=None, enabled=True)


@pytest.mark.asyncio
async def test_upsert_persists_plugin_errors(mem_session_maker: sessionmaker[Session]) -> None:
    """An install failure writes structured errors and records the attempt."""
    install_err = PluginError(source="install", severity="error", detail="pip failed: some reason")
    plugin_db.upsert_plugin_state(plugin_id="bad:plugin", version="unknown", enabled=True, plugin_errors=[install_err])

    state = plugin_db.get_plugin_state("bad:plugin")
    assert state is not None
    assert state.plugin_errors == [install_err.model_dump()]
    assert state.plugin_version == "unknown"
    assert state.updated_at is not None


@pytest.mark.asyncio
async def test_upsert_clears_plugin_errors_with_empty_list(mem_session_maker: sessionmaker[Session]) -> None:
    """Passing plugin_errors=[] clears previously stored errors; passing None leaves them untouched."""
    old_err = PluginError(source="install", severity="error", detail="old error")
    plugin_db.upsert_plugin_state(plugin_id="bad:plugin", version="0.1.0", plugin_errors=[old_err])
    # None should not touch the errors
    plugin_db.upsert_plugin_state(plugin_id="bad:plugin")
    state = plugin_db.get_plugin_state("bad:plugin")
    assert state is not None
    assert state.plugin_errors == [old_err.model_dump()]
    # [] should clear them
    plugin_db.upsert_plugin_state(plugin_id="bad:plugin", plugin_errors=[])
    state = plugin_db.get_plugin_state("bad:plugin")
    assert state is not None
    assert state.plugin_errors == []


@pytest.mark.asyncio
async def test_get_all_plugin_states(mem_session_maker: sessionmaker[Session]) -> None:
    """get_all_plugin_states returns all persisted rows."""
    plugin_db.upsert_plugin_state(plugin_id="storeA:p1", version="1.0", enabled=True)
    plugin_db.upsert_plugin_state(
        plugin_id="storeA:p2",
        version="unknown",
        enabled=True,
        plugin_errors=[PluginError(source="install", severity="error", detail="err")],
    )

    states = plugin_db.get_all_plugin_states()
    ids = {s.plugin_id for s in states}
    assert ids == {"storeA:p1", "storeA:p2"}


@pytest.mark.asyncio
async def test_get_plugin_state_missing(mem_session_maker: sessionmaker[Session]) -> None:
    """get_plugin_state returns None for a plugin not yet installed."""
    state = plugin_db.get_plugin_state("never:installed")
    assert state is None


@pytest.mark.asyncio
async def test_upsert_settings_partial_excluded(mem_session_maker: sessionmaker[Session]) -> None:
    """upsert_plugin_state overwrites excluded_templates when provided, leaves glyph_remapping unchanged."""
    plugin_db.upsert_plugin_state(plugin_id="s:p", version="1.0", enabled=True)
    plugin_db.upsert_plugin_state(plugin_id="s:p", excluded_templates=["tplA"])

    state = plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {}

    plugin_db.upsert_plugin_state(plugin_id="s:p", glyph_remapping={"old": "new"})
    state = plugin_db.get_plugin_state("s:p")
    assert state is not None
    assert state.excluded_templates == ["tplA"]
    assert state.glyph_remapping == {"old": "new"}


@pytest.mark.asyncio
async def test_upsert_settings_empty_list_clears(mem_session_maker: sessionmaker[Session]) -> None:
    """Passing an empty list for excluded_templates explicitly clears the stored list."""
    plugin_db.upsert_plugin_state(plugin_id="s:q", version="1.0", enabled=True)
    plugin_db.upsert_plugin_state(plugin_id="s:q", excluded_templates=["x", "y"])
    plugin_db.upsert_plugin_state(plugin_id="s:q", excluded_templates=[])

    state = plugin_db.get_plugin_state("s:q")
    assert state is not None
    assert state.excluded_templates == []


@pytest.mark.asyncio
async def test_upsert_settings_triggers_ingest_on_change(mem_session_maker: sessionmaker[Session]) -> None:
    """Changing excluded_templates or glyph_remapping sets asset_ingest_needed=True."""
    plugin_db.upsert_plugin_state(plugin_id="s:r", version="1.0", enabled=True)
    plugin_db.clear_asset_ingest_needed(plugin_id="s:r")

    plugin_db.upsert_plugin_state(plugin_id="s:r", excluded_templates=["tplZ"])

    state = plugin_db.get_plugin_state("s:r")
    assert state is not None
    assert state.asset_ingest_needed is True
