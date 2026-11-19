# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for NotificationBroadcaster: uninitialized-publish failure, register/broadcast/prune, and stop."""

import asyncio
import threading
import time
from collections.abc import Generator
from typing import cast

import pytest
from fastapi import WebSocket

from forecastbox.domain.notification.models import ClientNotification
from forecastbox.domain.notification.service import (
    NotificationBroadcaster,
    NotificationBroadcasterNotInitialized,
    init_broadcaster,
    publish,
    register_client,
    stop_broadcaster,
    unregister_client,
)


def _notification(identifier: str) -> ClientNotification:
    return ClientNotification(
        text=identifier,
        sourceDomainName="notification",
        sourceDomainEvent="test",
        context={"identifier": identifier},
        detailRoute=None,
        refreshRoutes=[],
    )


class _FakeClient:
    def __init__(self, fail: bool = False) -> None:
        self.received: list[str] = []
        self.fail = fail

    async def send_text(self, data: str) -> None:
        if self.fail:
            raise RuntimeError("boom")
        self.received.append(data)


@pytest.fixture(autouse=True)
def _reset_broadcaster() -> Generator[None, None, None]:
    original_loop = NotificationBroadcaster._loop
    original_stopped = NotificationBroadcaster._stopped
    original_clients = NotificationBroadcaster._clients
    yield
    NotificationBroadcaster._loop = original_loop
    NotificationBroadcaster._stopped = original_stopped
    NotificationBroadcaster._clients = original_clients


def test_publish_before_init_raises_and_does_not_hang() -> None:
    NotificationBroadcaster._loop = None
    NotificationBroadcaster._stopped = False
    with pytest.raises(NotificationBroadcasterNotInitialized):
        publish(_notification("x"))


def test_publish_broadcasts_to_registered_clients_and_prunes_dead() -> None:
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        init_broadcaster(loop)
        good = _FakeClient()
        bad = _FakeClient(fail=True)
        register_client(cast(WebSocket, good))
        register_client(cast(WebSocket, bad))

        publish(_notification("abc"))
        deadline = time.monotonic() + 2
        while (not good.received or bad in NotificationBroadcaster._clients) and time.monotonic() < deadline:
            time.sleep(0.01)

        assert len(good.received) == 1
        assert "abc" in good.received[0]
        assert bad not in NotificationBroadcaster._clients
        assert good in NotificationBroadcaster._clients

        unregister_client(cast(WebSocket, good))
        assert good not in NotificationBroadcaster._clients
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        loop.close()


def test_publish_after_stop_is_dropped() -> None:
    loop = asyncio.new_event_loop()
    try:
        init_broadcaster(loop)
        stop_broadcaster()
        assert NotificationBroadcaster._loop is None
        publish(_notification("dropped"))  # must neither raise nor block
    finally:
        loop.close()
