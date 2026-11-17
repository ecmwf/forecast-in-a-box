# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the periodic maintenance thread and its blueprint summary query."""

import threading
import time
from collections.abc import Callable, Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.maintenance.garbage_collector as gc
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.db import BlueprintStorageSummary
from forecastbox.domain.maintenance.exceptions import CleanupNotRunning
from forecastbox.routes.admin import trigger_cleanup_endpoint
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "sync_session_maker", maker)
    yield maker
    engine.dispose()


@pytest.fixture(autouse=True)
def reset_runtime() -> Generator[None, None, None]:
    gc.GarbageCollectorRuntime.status = gc.GarbageCollectorStatus(state=gc.GarbageCollectorState.stopped)
    gc.GarbageCollectorRuntime.wake.clear()
    yield
    gc.GarbageCollectorRuntime.status = gc.GarbageCollectorStatus(state=gc.GarbageCollectorState.stopped)
    gc.GarbageCollectorRuntime.wake.clear()


def _wait_for(predicate: Callable[[], bool], timeout: float = 2.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def test_summarize_empty(mem_session_maker: sessionmaker[Session]) -> None:
    assert blueprint_db.summarize_blueprint_storage() == BlueprintStorageSummary(0, 0, 0)


def test_summarize_counts(mem_session_maker: sessionmaker[Session]) -> None:
    auth = AuthContext(user_id="u", is_admin=True)
    bid, _ = blueprint_db.upsert_blueprint(auth_context=auth, source="user_defined", created_by="u", display_name="a")
    blueprint_db.upsert_blueprint(auth_context=auth, blueprint_id=bid, source="user_defined", created_by="u", display_name="a")
    bid2, v2 = blueprint_db.upsert_blueprint(auth_context=auth, source="user_defined", created_by="u", display_name="b")
    blueprint_db.soft_delete_blueprint(bid2, expected_version=v2, auth_context=auth)
    assert blueprint_db.summarize_blueprint_storage() == BlueprintStorageSummary(3, 1, 2)


def test_entrypoint_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake() -> BlueprintStorageSummary:
        calls.append(1)
        return BlueprintStorageSummary(1, 0, 1)

    monkeypatch.setattr(gc, "summarize_blueprint_storage", fake)
    stop = threading.Event()
    thread = threading.Thread(target=gc.garbage_collector_entrypoint, args=(stop,))
    thread.start()
    try:
        assert _wait_for(lambda: gc.garbage_collector_status().state == gc.GarbageCollectorState.idle)
        time.sleep(0.1)
        assert calls == []
        gc.trigger_cleanup()
        assert _wait_for(lambda: gc.garbage_collector_status().last_success_at is not None)
        status = gc.garbage_collector_status()
        assert len(calls) == 1
        assert status.last_result == BlueprintStorageSummary(1, 0, 1)
        assert _wait_for(lambda: gc.garbage_collector_status().next_wake_at is not None)
    finally:
        stop.set()
        gc.garbage_collector_stop_request(1.0)
        thread.join(2)
    assert not thread.is_alive()
    assert gc.garbage_collector_status().state == gc.GarbageCollectorState.stopped
    assert len(calls) == 1


def test_failing_query_keeps_thread_running(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail() -> BlueprintStorageSummary:
        raise RuntimeError("boom")

    monkeypatch.setattr(gc, "summarize_blueprint_storage", fail)
    stop = threading.Event()
    thread = threading.Thread(target=gc.garbage_collector_entrypoint, args=(stop,))
    thread.start()
    try:
        assert _wait_for(lambda: gc.garbage_collector_status().state == gc.GarbageCollectorState.idle)
        gc.trigger_cleanup()
        assert _wait_for(lambda: gc.garbage_collector_status().last_failure is not None)
        assert _wait_for(lambda: gc.garbage_collector_status().state == gc.GarbageCollectorState.idle)
        status = gc.garbage_collector_status()
        assert "boom" in (status.last_failure or "")
        assert status.last_success_at is None
        assert thread.is_alive()
    finally:
        stop.set()
        gc.garbage_collector_stop_request(1.0)
        thread.join(2)


def test_trigger_when_stopped() -> None:
    with pytest.raises(CleanupNotRunning):
        gc.trigger_cleanup()


@pytest.mark.asyncio
async def test_route_maps_to_409(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException

    import forecastbox.routes.admin as admin

    def raiser() -> None:
        raise CleanupNotRunning("nope")

    monkeypatch.setattr(admin, "trigger_cleanup", raiser)
    with pytest.raises(HTTPException) as e:
        await trigger_cleanup_endpoint(None)
    assert e.value.status_code == 409
