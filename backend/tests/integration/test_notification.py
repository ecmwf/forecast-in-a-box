# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration test for the notification websocket: register a client, trigger the testNotification
route, and assert the client receives the corresponding broadcast.

Other integration tests (potentially running concurrently against the same backend) may cause
their own, unrelated notifications to be emitted -- `wait_next_notification` takes care of ignoring
those.
"""

import uuid

import httpx

from .utils import connect_notification_websocket, wait_next_notification


def test_notification_websocket_receives_test_notification(backend_client: httpx.Client) -> None:
    identifier = uuid.uuid4().hex

    with connect_notification_websocket(backend_client) as websocket:
        response = backend_client.post("/notification/testNotification", json={"identifier": identifier})
        assert response.is_success

        notification = wait_next_notification(websocket, "notification", "testNotification", total_timeout=15)
        while notification.context.get("identifier") != identifier:
            # a testNotification from a different, concurrently running test -- ignore it
            notification = wait_next_notification(websocket, "notification", "testNotification", total_timeout=15)

        assert notification.sourceDomainName == "notification"
        assert notification.sourceDomainEvent == "testNotification"
        assert identifier in notification.text
