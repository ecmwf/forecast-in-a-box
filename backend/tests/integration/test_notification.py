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
their own, unrelated notifications to be emitted -- so the receive loop below ignores any
notification whose context does not carry our own identifier, and is bounded so it can never hang.
"""

import json
import time
import uuid

import httpx
import websockets.sync.client


def test_notification_websocket_receives_test_notification(backend_client: httpx.Client) -> None:
    ws_url = str(backend_client.base_url).rstrip("/").replace("http://", "ws://", 1) + "/notification/ws"
    identifier = uuid.uuid4().hex

    with websockets.sync.client.connect(ws_url, open_timeout=5) as websocket:
        response = backend_client.post("/notification/testNotification", json={"identifier": identifier})
        assert response.is_success

        notification = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                raw = websocket.recv(timeout=max(deadline - time.monotonic(), 0.1))
            except TimeoutError:
                break
            candidate = json.loads(raw)
            if candidate.get("context", {}).get("identifier") == identifier:
                notification = candidate
                break
            # a notification from a different domain/test running concurrently -- ignore it

        assert notification is not None, f"did not receive a matching test notification for identifier {identifier}"
        assert notification["sourceDomainName"] == "notification"
        assert notification["sourceDomainEvent"] == "testNotification"
        assert identifier in notification["text"]
