# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Notification routes -- /notification/*. Corresponds to `domain.notification`.

Contains:
 - a websocket endpoint that clients connect to in order to receive broadcast ClientNotification
   messages; registration is implicit (connect => registered, disconnect => unregistered),
 - a POST test endpoint that publishes a PlaceholderNotificationEvent through the event dispatcher, purely
   to exercise the dispatch-to-websocket path end to end (used by integration tests).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from forecastbox.domain.notification.events import PlaceholderNotificationEvent
from forecastbox.domain.notification.service import register_client, unregister_client
from forecastbox.utility.dispatcher import Event, EventName, submit_event
from forecastbox.utility.pydantic import FiabBaseModel

PREFIX = "/api/v1/notification"

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notification"])


class PlaceholderNotificationRequest(FiabBaseModel):
    identifier: str


class PlaceholderNotificationResponse(FiabBaseModel):
    status: str


@router.websocket("/ws")
async def notification_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    register_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        unregister_client(websocket)


@router.post("/testNotification")
async def test_notification(request: PlaceholderNotificationRequest) -> PlaceholderNotificationResponse:
    # NOTE deprecated but kept around until there is enough proper notifications which we can reliably
    # test for in an integration test. This should be surely removed before a proper multi-user deploy
    event = Event(name=EventName("notification.test"), payload=PlaceholderNotificationEvent(identifier=request.identifier))
    submit_event(event)
    return PlaceholderNotificationResponse(status="submitted")
