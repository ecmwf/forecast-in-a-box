# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for _ingest_plugin_templates -- in particular that reserved tag keys are
flagged and combined with validate_expand_sync errors, rather than raising or being
checked separately."""

from collections.abc import Generator
from unittest.mock import MagicMock

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.blueprint.service as blueprint_service
import forecastbox.domain.plugin.db as plugin_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.service import CORE_VERSION_MISMATCH_TAG_KEY, BlueprintBuilder, BlueprintValidationExpansion
from forecastbox.domain.plugin.db import get_plugin_state, upsert_plugin_state
from forecastbox.domain.plugin.manager import _ingest_plugin_templates
from forecastbox.schemata.jobs import Base

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("myStore"), local=PluginId("myPlugin"))
_PLUGIN_ID_STR = PluginCompositeId.to_str(_PLUGIN_ID)


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "sync_session_maker", maker)
    monkeypatch.setattr(plugin_db._jobs_module, "sync_session_maker", maker)
    yield maker
    engine.dispose()


def _make_template(tags: list[str]) -> MagicMock:
    template = MagicMock()
    template.display_name = "my_template"
    template.display_description = "desc"
    template.tags = tags
    template.example_values = {}
    template.example_glyphs = {}
    template.local_glyphs = {}
    return template


def _make_plugin(tags: list[str]) -> MagicMock:
    plugin = MagicMock()
    plugin.blueprint_templates = (_make_template(tags),)
    return plugin


def _patch_validation_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bypass real blueprint validation -- irrelevant to this test, and would otherwise
    require a fully-fledged plugin catalogue."""
    monkeypatch.setattr(blueprint_service, "template_to_builder", lambda template, plugin_id: BlueprintBuilder())
    monkeypatch.setattr(blueprint_service, "resolve_builder_with_examples", lambda builder, example_values, example_glyphs: builder)
    monkeypatch.setattr(
        blueprint_service,
        "validate_expand_sync",
        lambda builder, auth, validate_only: BlueprintValidationExpansion(
            global_errors=[], block_errors={}, possible_sources=[], possible_expansions={}
        ),
    )


def test_ingest_plugin_templates_reserved_tag_recorded_as_template_error(
    mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0")
    _patch_validation_ok(monkeypatch)
    plugin = _make_plugin(tags=[CORE_VERSION_MISMATCH_TAG_KEY])

    _ingest_plugin_templates(_PLUGIN_ID, plugin)

    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None
    assert "my_template" in state.template_errors
    assert CORE_VERSION_MISMATCH_TAG_KEY in state.template_errors["my_template"]


def test_ingest_plugin_templates_normal_tag_not_flagged(mem_session_maker: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    upsert_plugin_state(plugin_id=_PLUGIN_ID_STR, version="1.0")
    _patch_validation_ok(monkeypatch)
    plugin = _make_plugin(tags=["normal-tag"])

    _ingest_plugin_templates(_PLUGIN_ID, plugin)

    state = get_plugin_state(_PLUGIN_ID_STR)
    assert state is not None
    assert state.template_errors == {}
