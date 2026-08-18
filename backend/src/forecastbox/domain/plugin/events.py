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


@dataclass(frozen=True, eq=True, slots=True)
class PluginGlobalErrorEvent:
    """Emitted whenever the plugin updater thread fails, mirroring ``PluginManager.updater_error``."""

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
            detailRoute="api/v1/plugin/list",
            refreshRoutes=["api/v1/plugin/list"],
        )
