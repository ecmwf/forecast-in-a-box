# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Client notification helpers for managed plugin operations."""

import logging

from forecastbox.domain.plugin.events import PluginGlobalErrorEvent, PluginSuccessNotification
from forecastbox.utility.dispatcher import Event, EventName, submit_event

logger = logging.getLogger(__name__)


def notify_failure(trigger: str, message: str) -> None:
    try:
        submit_event(
            Event(
                name=EventName("plugin.global_error"),
                payload=PluginGlobalErrorEvent(trigger=trigger, error=message),
            )
        )
    except Exception as e:
        logger.exception(f"failed to submit plugin global-error notification for {trigger!r}: {repr(e)}")


def notify_success(payload: PluginSuccessNotification) -> None:
    notification = payload.as_client_notification()
    suffix = notification.sourceDomainEvent[len("plugin") :]
    event_name = "plugin." + suffix[:1].lower() + suffix[1:]
    try:
        submit_event(Event(name=EventName(event_name), payload=payload))
    except Exception as e:
        logger.exception(f"failed to submit plugin success notification {event_name!r}: {repr(e)}")
