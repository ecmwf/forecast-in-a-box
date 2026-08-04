# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Events emitted by the Notification domain itself.

Other domains declare their own events in their own ``events.py`` submodule -- this module only
holds the notification domain's own events, currently just the one used for integration testing.
"""

from dataclasses import dataclass

from forecastbox.domain.notification.models import ClientNotification


@dataclass(frozen=True, eq=True, slots=True)
class TestNotificationEvent:
    """Emitted by the ``testNotification`` route, purely to exercise the dispatch-to-websocket path."""

    __test__ = False  # not a pytest test class, despite the name -- silences pytest collection warnings

    identifier: str

    def as_client_notification(self) -> ClientNotification:
        return ClientNotification(
            text=f"test notification {self.identifier}",
            sourceDomainName="notification",
            sourceDomainEvent="testNotification",
            context={"identifier": self.identifier},
            detailRoute=None,
            refreshRoutes=[],
        )
