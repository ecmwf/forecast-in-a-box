# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Events emitted by the Plugin domain."""

from dataclasses import dataclass

from forecastbox.domain.notification.models import ClientNotification
from forecastbox.utility.config import ROUTE_PREFIX


@dataclass(frozen=True, eq=True, slots=True)
class PluginGlobalErrorEvent:
    """Emitted whenever a managed plugin-management task fails unexpectedly, mirroring the
    domain-facing ``updater_error`` field in ``forecastbox.domain.plugin.state.PluginManager``."""

    trigger: str
    """What operation was running when the failure occurred, e.g. ``"Initial plugin load"`` or
    ``"Update of plugin {pluginId}"``."""
    error: str
    """The same error text stored in ``PluginManager.updater_error``."""

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"{self.trigger} failed: {self.error}",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginGlobalError",
            context={"trigger": self.trigger, "error": self.error},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


@dataclass(frozen=True, eq=True, slots=True)
class PluginInstalledEvent:
    """Emitted once a plugin has been installed and loaded successfully for the first time,
    corresponding to the ``POST /api/v1/plugin/install`` route."""

    plugin_id: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Plugin {self.plugin_id} installed successfully",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginInstalled",
            context={"plugin_id": self.plugin_id},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


@dataclass(frozen=True, eq=True, slots=True)
class PluginUpdatedEvent:
    """Emitted once an already-installed plugin has been updated (pip re-install plus reload)
    successfully, corresponding to the ``POST /api/v1/plugin/update`` route."""

    plugin_id: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Plugin {self.plugin_id} updated successfully",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginUpdated",
            context={"plugin_id": self.plugin_id},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


@dataclass(frozen=True, eq=True, slots=True)
class PluginSettingsAppliedEvent:
    """Emitted once a plugin's settings change (excluding disable) has been applied and the
    plugin reloaded/re-ingested successfully, corresponding to the ``POST /api/v1/plugin/settings``
    route when the plugin stays enabled."""

    plugin_id: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Plugin {self.plugin_id} settings applied successfully",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginSettingsApplied",
            context={"plugin_id": self.plugin_id},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


@dataclass(frozen=True, eq=True, slots=True)
class PluginUnloadedEvent:
    """Emitted once a plugin has been disabled/unloaded successfully, corresponding to the
    ``POST /api/v1/plugin/settings`` route when ``isEnabled`` is set to ``False``."""

    plugin_id: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Plugin {self.plugin_id} disabled successfully",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginUnloaded",
            context={"plugin_id": self.plugin_id},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


@dataclass(frozen=True, eq=True, slots=True)
class PluginUninstalledEvent:
    """Emitted once a plugin has been uninstalled successfully, corresponding to the
    ``POST /api/v1/plugin/uninstall`` route."""

    plugin_id: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Plugin {self.plugin_id} uninstalled successfully",
            sourceDomainName="plugin",
            sourceDomainEvent="pluginUninstalled",
            context={"plugin_id": self.plugin_id},
            detailRoute=f"{ROUTE_PREFIX}/plugin/list",
            refreshRoutes=[f"{ROUTE_PREFIX}/plugin/list"],
        )


PluginSuccessNotification = (
    PluginInstalledEvent | PluginUpdatedEvent | PluginSettingsAppliedEvent | PluginUnloadedEvent | PluginUninstalledEvent
)
"""Union of all plugin-domain events that represent a successful operation completion,
deliberately excluding ``PluginGlobalErrorEvent`` so the type system flags any attempt to
pass a failure event where a success notification is expected."""
