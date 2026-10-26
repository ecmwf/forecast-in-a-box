# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Events emitted when a gateway stop operation completes."""

from dataclasses import dataclass

from forecastbox.domain.notification.models import ClientNotification
from forecastbox.utility.config import ROUTE_PREFIX

_GATEWAY_STATUS_URL = f"{ROUTE_PREFIX}/gateway/status"


@dataclass(frozen=True, eq=True, slots=True)
class GatewayStoppedEvent:
    """Emitted when a gateway stop operation completes successfully."""

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text="Gateway stopped successfully",
            sourceDomainName="gateway",
            sourceDomainEvent="gatewayStopped",
            context={},
            detailRoute=_GATEWAY_STATUS_URL,
            refreshRoutes=[_GATEWAY_STATUS_URL],
        )


@dataclass(frozen=True, eq=True, slots=True)
class GatewayStopFailedEvent:
    """Emitted when a gateway stop operation fails."""

    error: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"Gateway stop failed: {self.error}",
            sourceDomainName="gateway",
            sourceDomainEvent="gatewayStopFailed",
            context={"error": self.error},
            detailRoute=_GATEWAY_STATUS_URL,
            refreshRoutes=[_GATEWAY_STATUS_URL],
        )
