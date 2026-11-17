# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Registers the blueprint domain's handlers for plugin template events, auto-discovered by
`entrypoint.initializers._discover_dispatchers`.
"""

from forecastbox.domain.blueprint.template_ingest import ingest_plugin_templates, remove_plugin_templates
from forecastbox.domain.plugin.events import PluginTemplatesChangedEvent, PluginTemplatesRemovedEvent
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.dispatcher import DispatcherRegistration, Event


def _handle_templates_changed(event: Event) -> None:
    if not isinstance(event.payload, PluginTemplatesChangedEvent):
        raise TypeError(event.payload.__class__.__name__)
    ingest_plugin_templates(event.payload.plugin_id)


def _handle_templates_removed(event: Event) -> None:
    if not isinstance(event.payload, PluginTemplatesRemovedEvent):
        raise TypeError(event.payload.__class__.__name__)
    remove_plugin_templates(event.payload.plugin_id)


# NOTE the pool must not be PluginManagement (the producer occupies its only worker while waiting
# for the receipt, which would deadlock) and must not be JobsDb (reserved for single async-bridged
# DB calls).
dispatchers = (
    DispatcherRegistration(
        handler_id="blueprint.plugin_templates_changed",
        handler_type=PluginTemplatesChangedEvent,
        pool_name=ConcurrentPools.General,
        handler=_handle_templates_changed,
    ),
    DispatcherRegistration(
        handler_id="blueprint.plugin_templates_removed",
        handler_type=PluginTemplatesRemovedEvent,
        pool_name=ConcurrentPools.General,
        handler=_handle_templates_removed,
    ),
)
