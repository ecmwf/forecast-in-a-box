# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests of the event handling of triggers: the definition loaders and run submission are
mocked, the handled-event table is a real sqlite database."""

import datetime as dt
import threading
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cascade.low.func import Either
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import forecastbox.domain.experiment.triggers.db as trigger_db
import forecastbox.domain.experiment.triggers.service as service
import forecastbox.schemata.blueprint  # noqa: F401 -- registers the table referenced by the experiment foreign key
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.db import ExperimentDefinitionRecord
from forecastbox.domain.experiment.exceptions import ExperimentNotFound
from forecastbox.domain.experiment.triggers import control
from forecastbox.domain.experiment.triggers.exceptions import TriggerNotFound, TriggerSpecInvalid
from forecastbox.domain.experiment.triggers.spec import AvisoEvent
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.service import ExecuteResult
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.time import current_time

EXP = ExperimentDefinitionId("exp-1")


class Harness:
    """Holds the mocked collaborators of `handle_event` and the definition it currently sees."""

    def __init__(self) -> None:
        self.blob: dict[str, Any] | None = {"source": "aviso", "event_type": "mars", "max_acceptable_delay_hours": 24}
        self.experiment_type = "external_trigger"
        self.blueprint: MagicMock | None = MagicMock(name="blueprint")
        self.submit = MagicMock(side_effect=self._submit)
        self.run_counter = 0

    def _submit(self, *args: Any, **kwargs: Any) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
        self.run_counter += 1
        return Either.ok(ExecuteResult(run_id=RunId(f"run-{self.run_counter}"), attempt_count=1))

    def definition(self, *args: Any, **kwargs: Any) -> ExperimentDefinitionRecord | None:
        if self.blob is None:
            return None
        return ExperimentDefinitionRecord(
            experiment_definition_id=EXP,
            version=4,
            created_by="alice",
            created_at=current_time("dbref"),
            display_name=None,
            display_description=None,
            tags=None,
            blueprint_id=BlueprintId("bp-1"),
            blueprint_version=2,
            experiment_type=self.experiment_type,  # ty:ignore[invalid-argument-type]
            experiment_definition=self.blob,
            is_deleted=False,
        )


@pytest.fixture
def harness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[Harness, None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(trigger_db._jobs_module, "sync_session_maker", sessionmaker(engine, expire_on_commit=False))
    h = Harness()
    monkeypatch.setattr(service.experiment_db, "get_experiment_definition", h.definition)
    monkeypatch.setattr(service.blueprint_db, "get_blueprint", lambda *a, **k: h.blueprint)
    monkeypatch.setattr(service, "submit_run_sync", h.submit)
    yield h
    engine.dispose()


def _event(
    sequence: int = 1,
    event_type: str = "mars",
    identifier: dict[str, Any] | None = None,
    age: dt.timedelta = dt.timedelta(minutes=1),
    source: Any = "aviso",
) -> AvisoEvent:
    return AvisoEvent(
        source=source,
        event_type=event_type,
        sequence=sequence,
        identifier={"date": "20261103", "step": 6} if identifier is None else identifier,
        payload=None,
        published_at=current_time("scheduling") - age,
    )


def _rows() -> list[trigger_db.TriggerEventRecord]:
    return trigger_db.list_events(EXP, limit=100)


def test_submitted_records_run_and_passes_glyphs(harness: Harness) -> None:
    result = service.handle_event(EXP, _event(7))
    assert result == service.HandleResult("submitted", run_id="run-1")

    harness.submit.assert_called_once()
    args, kwargs = harness.submit.call_args
    assert args[0] is harness.blueprint
    assert args[1] == AuthContext(user_id="alice", is_admin=False)
    assert kwargs["experiment_id"] == EXP
    assert kwargs["experiment_version"] == 4
    assert kwargs["experiment_context"] == "aviso:mars#7"
    context: CompilerRuntimeContext = kwargs["compiler_runtime_context"]
    assert context.glyphs["aviso_date"] == "20261103"
    assert context.glyphs["aviso_step"] == "6"
    assert context.glyphs["aviso_sequence"] == "7"
    assert context.glyphs["aviso_event_type"] == "mars"

    (row,) = _rows()
    assert (row.status, row.run_id, row.message, row.sequence, row.source) == ("submitted", "run-1", None, 7, "aviso")


def test_glyph_map_applied(harness: Harness) -> None:
    assert harness.blob is not None
    harness.blob["glyph_map"] = {"date": "forecastDate"}
    service.handle_event(EXP, _event())
    context: CompilerRuntimeContext = harness.submit.call_args.kwargs["compiler_runtime_context"]
    assert context.glyphs["forecastDate"] == "20261103"


def test_disabled_ignored_without_recording(harness: Harness) -> None:
    assert harness.blob is not None
    harness.blob["enabled"] = False
    assert service.handle_event(EXP, _event()) == service.HandleResult("ignored_disabled")
    harness.submit.assert_not_called()
    assert _rows() == []


def test_deleted_ignored_without_recording(harness: Harness) -> None:
    harness.blob = None
    assert service.handle_event(EXP, _event()) == service.HandleResult("ignored_deleted")
    harness.submit.assert_not_called()
    assert _rows() == []


def test_other_experiment_type_ignored_as_deleted(harness: Harness) -> None:
    harness.experiment_type = "cron_schedule"
    assert service.handle_event(EXP, _event()).status == "ignored_deleted"
    harness.submit.assert_not_called()
    assert _rows() == []


def test_stale_event_recorded_not_submitted(harness: Harness) -> None:
    stale = _event(2, age=dt.timedelta(hours=25))
    assert service.handle_event(EXP, stale) == service.HandleResult("skipped_stale")
    harness.submit.assert_not_called()
    (row,) = _rows()
    assert (row.status, row.sequence, row.run_id) == ("skipped_stale", 2, None)
    # the same stale event arriving again is already handled
    assert service.handle_event(EXP, stale).status == "duplicate"
    assert len(_rows()) == 1


def test_event_within_delay_is_not_stale(harness: Harness) -> None:
    assert service.handle_event(EXP, _event(age=dt.timedelta(hours=23))).status == "submitted"


def test_duplicate_claim_submits_once(harness: Harness) -> None:
    assert service.handle_event(EXP, _event(3)).status == "submitted"
    assert service.handle_event(EXP, _event(3)) == service.HandleResult("duplicate")
    harness.submit.assert_called_once()
    assert len(_rows()) == 1


def test_already_claimed_by_other_handler_is_duplicate(harness: Harness) -> None:
    assert trigger_db.claim_event(EXP, _event(3))
    assert service.handle_event(EXP, _event(3)).status == "duplicate"
    harness.submit.assert_not_called()


def test_concurrent_handlers_submit_once(harness: Harness) -> None:
    results: list[service.HandleResult] = []
    barrier = threading.Barrier(4)

    def worker() -> None:
        barrier.wait()
        results.append(service.handle_event(EXP, _event(9)))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status for r in results) == ["duplicate", "duplicate", "duplicate", "submitted"]
    assert harness.submit.call_count == 1


def test_glyph_collision_recorded_as_failed(harness: Harness) -> None:
    result = service.handle_event(EXP, _event(identifier={"a-b": "1", "a_b": "2"}))
    assert result.status == "failed"
    assert result.message is not None and "aviso_a_b" in result.message
    harness.submit.assert_not_called()
    (row,) = _rows()
    assert row.status == "failed"
    assert row.message == result.message


def test_metadata_collision_recorded_as_failed(harness: Harness) -> None:
    assert service.handle_event(EXP, _event(identifier={"sequence": "1"})).status == "failed"
    assert _rows()[0].status == "failed"


def test_submit_exception_recorded_and_later_event_submitted(harness: Harness) -> None:
    harness.submit.side_effect = [RuntimeError("boom"), Either.ok(ExecuteResult(run_id=RunId("run-ok"), attempt_count=1))]
    first = service.handle_event(EXP, _event(1))
    assert first.status == "failed"
    assert first.message == "RuntimeError: boom"
    second = service.handle_event(EXP, _event(2))
    assert second == service.HandleResult("submitted", run_id="run-ok")
    by_sequence = {row.sequence: row for row in _rows()}
    assert (by_sequence[1].status, by_sequence[1].message) == ("failed", "RuntimeError: boom")
    assert (by_sequence[2].status, by_sequence[2].run_id) == ("submitted", "run-ok")
    # a failed event is not retried
    assert service.handle_event(EXP, _event(1)).status == "duplicate"
    assert harness.submit.call_count == 2


def test_submit_error_result_recorded_as_failed(harness: Harness) -> None:
    harness.submit.side_effect = None
    harness.submit.return_value = Either.error("Run submission rejected, try again later")
    result = service.handle_event(EXP, _event())
    assert result == service.HandleResult("failed", message="Run submission rejected, try again later")
    assert _rows()[0].status == "failed"


def test_missing_blueprint_recorded_as_failed(harness: Harness) -> None:
    harness.blueprint = None
    result = service.handle_event(EXP, _event())
    assert result.status == "failed"
    assert result.message is not None and "bp-1" in result.message
    harness.submit.assert_not_called()


def test_out_of_order_sequences_both_processed(harness: Harness) -> None:
    assert service.handle_event(EXP, _event(10)).status == "submitted"
    assert service.handle_event(EXP, _event(4)).status == "submitted"
    assert harness.submit.call_count == 2
    assert {row.sequence for row in _rows()} == {4, 10}


def test_same_sequence_other_event_type_processed(harness: Harness) -> None:
    assert service.handle_event(EXP, _event(5, event_type="mars")).status == "submitted"
    assert service.handle_event(EXP, _event(5, event_type="dissemination")).status == "submitted"
    assert service.handle_event(EXP, _event(5, event_type="mars", source="synthetic")).status == "submitted"
    assert harness.submit.call_count == 3
    assert service.handle_event(EXP, _event(5, event_type="mars")).status == "duplicate"


def test_invalid_stored_spec_returns_failed_without_recording(harness: Harness) -> None:
    harness.blob = {"source": "aviso"}
    result = service.handle_event(EXP, _event())
    assert result.status == "failed"
    assert result.message is not None and "invalid trigger specification" in result.message
    assert _rows() == []


def test_database_failure_never_raises(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*args: Any, **kwargs: Any) -> bool:
        raise RuntimeError("database gone")

    monkeypatch.setattr(trigger_db, "claim_event", broken)
    result = service.handle_event(EXP, _event())
    assert result.status == "failed"
    harness.submit.assert_not_called()


def test_finish_failure_keeps_result(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("database gone")

    monkeypatch.setattr(trigger_db, "finish_event", broken)
    assert service.handle_event(EXP, _event()).status == "submitted"
    assert _rows()[0].status == "claimed"  # reported as stuck later


# *** synthetic events ***


def test_synthetic_sequence_increasing_and_time_seeded() -> None:
    before_ms = int(current_time("scheduling").timestamp() * 1000)
    values = [service.next_synthetic_sequence() for _ in range(50)]
    assert values[0] >= before_ms
    assert values == sorted(set(values))


def test_synthetic_sequence_unique_across_threads() -> None:
    collected: list[int] = []

    def worker() -> None:
        collected.extend(service.next_synthetic_sequence() for _ in range(200))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(collected) == len(set(collected)) == 800


@pytest.mark.asyncio
async def test_fire_builds_synthetic_event(harness: Harness) -> None:
    assert harness.blob is not None
    harness.blob["event_type"] = "dissemination"
    fired = await service.fire_trigger(EXP, {"date": "20261103"})
    assert fired.result.status == "submitted"
    (row,) = _rows()
    assert (row.source, row.event_type, row.sequence, row.status) == ("synthetic", "dissemination", fired.sequence, "submitted")
    assert harness.submit.call_args.kwargs["experiment_context"] == f"synthetic:dissemination#{fired.sequence}"
    again = await service.fire_trigger(EXP, {"date": "20261103"})
    assert again.sequence != fired.sequence
    assert again.result.status == "submitted"
    assert harness.submit.call_count == 2


@pytest.mark.asyncio
async def test_fire_unknown_or_wrong_type(harness: Harness) -> None:
    harness.blob = None
    with pytest.raises(TriggerNotFound):
        await service.fire_trigger(EXP, {})
    harness.blob = {"source": "aviso", "event_type": "mars"}
    harness.experiment_type = "cron_schedule"
    with pytest.raises(TriggerNotFound):
        await service.fire_trigger(EXP, {})


@pytest.mark.asyncio
async def test_fire_disabled_ignored(harness: Harness) -> None:
    assert harness.blob is not None
    harness.blob["enabled"] = False
    fired = await service.fire_trigger(EXP, {"date": "20261103"})
    assert fired.result.status == "ignored_disabled"
    assert _rows() == []


# *** crud ***


@pytest.fixture
def listener_prods() -> Generator[MagicMock, None, None]:
    prod = MagicMock()
    control.register(prod, lambda: control.ListenerStatus(state="listening"))
    yield prod
    control.unregister()


@pytest.mark.asyncio
async def test_create_validates_and_prods(monkeypatch: pytest.MonkeyPatch, listener_prods: MagicMock) -> None:
    upsert = MagicMock(return_value=(ExperimentDefinitionId("new"), 1))
    monkeypatch.setattr(service.experiment_db, "upsert_experiment_definition", upsert)
    blueprint = MagicMock(blueprint_id="bp-1", version=2)
    monkeypatch.setattr(service.blueprint_db, "get_blueprint", lambda *a, **k: blueprint)
    auth = AuthContext(user_id="alice", is_admin=False)

    def create(glyph_map: dict[str, str]) -> Any:
        return service.create_trigger(auth, BlueprintId("bp-1"), None, "mars", {"class": "od"}, glyph_map, 12, True, "name", None, None)

    with pytest.raises(TriggerSpecInvalid):
        await create({"date": "aviso_date"})
    upsert.assert_not_called()
    listener_prods.assert_not_called()

    assert await create({"date": "forecastDate"}) == "new"
    kwargs = upsert.call_args.kwargs
    assert kwargs["experiment_type"] == "external_trigger"
    assert kwargs["blueprint_version"] == 2
    assert kwargs["created_by"] == "alice"
    assert kwargs["experiment_definition"] == {
        "source": "aviso",
        "event_type": "mars",
        "filter": {"class": "od"},
        "glyph_map": {"date": "forecastDate"},
        "max_acceptable_delay_hours": 12,
        "enabled": True,
    }
    listener_prods.assert_called_once()


@pytest.mark.asyncio
async def test_create_unknown_blueprint(monkeypatch: pytest.MonkeyPatch, listener_prods: MagicMock) -> None:
    monkeypatch.setattr(service.blueprint_db, "get_blueprint", lambda *a, **k: None)
    with pytest.raises(ExperimentNotFound):
        await service.create_trigger(
            AuthContext(user_id="alice", is_admin=False), BlueprintId("nope"), None, "mars", {}, {}, 24, True, None, None, None
        )
    listener_prods.assert_not_called()
