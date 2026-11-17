# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain.plugin.service."""

from collections.abc import Generator
from unittest.mock import MagicMock

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.plugin.db as plugin_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.plugin.db import get_plugin_state, upsert_plugin_state
from forecastbox.domain.plugin.exceptions import PluginTemplatesUnavailable
from forecastbox.domain.plugin.service import begin_template_ingest, record_template_errors
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.schemata.jobs import Base

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("myStore"), local=PluginId("myPlugin"))
_PLUGIN_ID_STR = PluginCompositeId.to_str(_PLUGIN_ID)


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "sync_session_maker", maker)
    monkeypatch.setattr(plugin_db._jobs_module, "sync_session_maker", maker)
    yield maker
    engine.dispose()


def _publish(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    plugin = MagicMock()
    plugin.blueprint_templates = ()
    monkeypatch.setattr(PluginManager, "plugins", pmap({_PLUGIN_ID: plugin}))
    return plugin


def test_unpublished_plugin_raises(mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginManager, "plugins", pmap())
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0", pip_source="src", module_name="mod")
    with pytest.raises(PluginTemplatesUnavailable):
        begin_template_ingest(_PLUGIN_ID)


def test_missing_state_row_raises(mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    _publish(monkeypatch)
    with pytest.raises(PluginTemplatesUnavailable):
        begin_template_ingest(_PLUGIN_ID)


def test_returns_spec_and_clears_flag_then_none(mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    plugin = _publish(monkeypatch)
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0", pip_source="src", module_name="mod")
    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None and state.asset_ingest_needed

    spec = begin_template_ingest(_PLUGIN_ID)
    assert spec is not None
    assert spec.plugin_id == _PLUGIN_ID
    assert spec.templates == tuple(plugin.blueprint_templates)
    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None and not state.asset_ingest_needed

    assert begin_template_ingest(_PLUGIN_ID) is None


def test_none_leaves_flag_untouched(mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    _publish(monkeypatch)
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0", pip_source="src", module_name="mod")
    assert begin_template_ingest(_PLUGIN_ID) is not None
    assert begin_template_ingest(_PLUGIN_ID) is None
    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None and not state.asset_ingest_needed


def test_record_template_errors_persists(mem_session_maker: sessionmaker[Session]) -> None:
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0", pip_source="src", module_name="mod")
    record_template_errors(_PLUGIN_ID, {"t": "bad"})
    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None
    assert state.template_errors == {"t": "bad"}
