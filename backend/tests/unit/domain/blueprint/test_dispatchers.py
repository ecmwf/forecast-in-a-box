# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the blueprint domain's plugin template dispatcher registrations, and static
guards on the plugin -> blueprint dependency direction."""

from pathlib import Path
from unittest.mock import patch

from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

import forecastbox.domain.blueprint.dispatchers as dispatchers_module
from forecastbox.domain.plugin.events import PluginTemplatesChangedEvent, PluginTemplatesRemovedEvent
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.dispatcher import Event, EventName

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p"))


def test_registrations() -> None:
    by_id = {r.handler_id: r for r in dispatchers_module.dispatchers}
    assert by_id["blueprint.plugin_templates_changed"].handler_type is PluginTemplatesChangedEvent
    assert by_id["blueprint.plugin_templates_removed"].handler_type is PluginTemplatesRemovedEvent
    assert all(r.pool_name == ConcurrentPools.General for r in by_id.values())
    assert len(by_id) == 2


def test_handlers_call_ingest_and_remove() -> None:
    changed, removed = dispatchers_module.dispatchers
    with patch.object(dispatchers_module, "ingest_plugin_templates") as ingest:
        changed.handler(Event(EventName("x"), PluginTemplatesChangedEvent(plugin_id=_PLUGIN_ID)))
    ingest.assert_called_once_with(_PLUGIN_ID)
    with patch.object(dispatchers_module, "remove_plugin_templates") as remove:
        removed.handler(Event(EventName("x"), PluginTemplatesRemovedEvent(plugin_id=_PLUGIN_ID)))
    remove.assert_called_once_with(_PLUGIN_ID)


def test_plugin_domain_does_not_import_blueprint() -> None:
    root = Path(__file__).resolve().parents[4] / "src" / "forecastbox" / "domain"
    for path in (root / "plugin").rglob("*.py"):
        assert "forecastbox.domain.blueprint" not in path.read_text(), path
    ingest_text = (root / "blueprint" / "template_ingest.py").read_text()
    assert "forecastbox.domain.plugin.db" not in ingest_text
    assert "forecastbox.domain.plugin.state" not in ingest_text
