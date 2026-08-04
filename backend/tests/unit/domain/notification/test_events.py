# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the PlaceholderNotificationEvent -- protocol conformance and conversion."""

from forecastbox.domain.notification.events import PlaceholderNotificationEvent
from forecastbox.domain.notification.models import ClientNotification, ClientNotificationSource


def test_test_notification_event_implements_protocol() -> None:
    event = PlaceholderNotificationEvent(identifier="abc123")
    assert isinstance(event, ClientNotificationSource)


def test_test_notification_event_as_client_notification() -> None:
    event = PlaceholderNotificationEvent(identifier="abc123")
    notification = event.as_client_notification()

    assert isinstance(notification, ClientNotification)
    assert "abc123" in notification.text
    assert notification.sourceDomainName == "notification"
    assert notification.sourceDomainEvent == "testNotification"
    assert notification.context == {"identifier": "abc123"}
    assert notification.detailRoute is None
    assert notification.refreshRoutes == []
