# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the plugin domain's client-notification events."""

from forecastbox.domain.plugin.events import (
    PluginInstalledEvent,
    PluginSettingsAppliedEvent,
    PluginUninstalledEvent,
    PluginUnloadedEvent,
    PluginUpdatedEvent,
)

_PLUGIN_ID = "store/plugin"


def test_plugin_installed_event_notification() -> None:
    notification = PluginInstalledEvent(plugin_id=_PLUGIN_ID).as_client_notification()
    assert notification.sourceDomainName == "plugin"
    assert notification.sourceDomainEvent == "pluginInstalled"
    assert notification.context == {"plugin_id": _PLUGIN_ID}
    assert _PLUGIN_ID in notification.text


def test_plugin_updated_event_notification() -> None:
    notification = PluginUpdatedEvent(plugin_id=_PLUGIN_ID).as_client_notification()
    assert notification.sourceDomainEvent == "pluginUpdated"
    assert notification.context == {"plugin_id": _PLUGIN_ID}


def test_plugin_settings_applied_event_notification() -> None:
    notification = PluginSettingsAppliedEvent(plugin_id=_PLUGIN_ID).as_client_notification()
    assert notification.sourceDomainEvent == "pluginSettingsApplied"
    assert notification.context == {"plugin_id": _PLUGIN_ID}


def test_plugin_unloaded_event_notification() -> None:
    notification = PluginUnloadedEvent(plugin_id=_PLUGIN_ID).as_client_notification()
    assert notification.sourceDomainEvent == "pluginUnloaded"
    assert notification.context == {"plugin_id": _PLUGIN_ID}


def test_plugin_uninstalled_event_notification() -> None:
    notification = PluginUninstalledEvent(plugin_id=_PLUGIN_ID).as_client_notification()
    assert notification.sourceDomainEvent == "pluginUninstalled"
    assert notification.context == {"plugin_id": _PLUGIN_ID}
