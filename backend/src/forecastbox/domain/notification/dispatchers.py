# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Registers the notification domain's dispatcher handler, auto-discovered by
`entrypoint.app._discover_dispatchers`.

Matches on the `ClientNotificationSource` protocol rather than any concrete event type or name --
any domain's event that implements `as_client_notification` gets converted and forwarded to the
websocket broadcaster, regardless of which domain emitted it.
"""

from forecastbox.domain.notification.models import ClientNotificationSource
from forecastbox.domain.notification.service import publish
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.dispatcher import DispatcherRegistration, Event


def _handle_client_notification_source(event: Event) -> None:
    if not isinstance(event.payload, ClientNotificationSource):
        raise TypeError(event.payload.__class__.__name__)
    publish(event.payload.as_client_notification())


dispatchers = (
    DispatcherRegistration(
        handler_id="notification.client_notification_source",
        handler_type=ClientNotificationSource,
        pool_name=ConcurrentPools.General,
        handler=_handle_client_notification_source,
    ),
)
