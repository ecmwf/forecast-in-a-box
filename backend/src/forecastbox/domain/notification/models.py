# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Contracts for the Notification domain: the wire message delivered to websocket clients, and the
protocol that other domains' events implement to produce one.
"""

from typing import Any, Protocol, runtime_checkable

from forecastbox.utility.pydantic import FiabBaseModel


class ClientNotification(FiabBaseModel):
    """The json message delivered to connected websocket clients."""

    text: str  # the full text that the frontend will display
    sourceDomainName: str  # domain as understood by backend: artifact, plugin, blueprint, run, ...
    sourceDomainEvent: str  # event name within the domain: artifactDownloaded, pluginUpdated, runFinished, ...
    context: dict[str, Any]  # arbitrary key-value, with schema specific to the sourceDomainEvent
    detailRoute: str | None  # optionally a direct route that the client could visit for more details
    refreshRoutes: list[str]  # possibly empty list of routes that the client should refresh to update its internal state


@runtime_checkable
class ClientNotificationSource(Protocol):
    """Implemented by domain events that should be surfaced to clients as a ClientNotification."""

    def as_client_notification(self) -> ClientNotification:
        raise NotImplementedError
