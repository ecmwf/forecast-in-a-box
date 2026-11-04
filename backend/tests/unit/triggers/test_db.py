# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the handled-event table helpers and the active trigger query, on a temporary sqlite file."""

import datetime as dt
import logging
import threading
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session, sessionmaker

import forecastbox.domain.experiment.triggers.db as trigger_db
import forecastbox.schemata.blueprint  # noqa: F401 -- registers the table referenced by the experiment foreign key
from forecastbox.domain.experiment.triggers.spec import AvisoEvent
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.experiment import ExperimentDefinition, ExperimentTriggerEvent
from forecastbox.schemata.jobs import Base

EXP = ExperimentDefinitionId("exp-1")
T0 = dt.datetime(2026, 11, 3, 12, 0, tzinfo=dt.UTC)


@pytest.fixture
def session_maker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(trigger_db._jobs_module, "sync_session_maker", maker)
    yield maker
    engine.dispose()


def _event(sequence: int = 1, source: Any = "aviso", event_type: str = "mars", published_at: dt.datetime = T0) -> AvisoEvent:
    return AvisoEvent(
        source=source,
        event_type=event_type,
        sequence=sequence,
        identifier={"date": "20261103"},
        payload=None,
        published_at=published_at,
    )


def _add_definition(
    maker: sessionmaker[Session],
    experiment_id: str,
    version: int,
    *,
    experiment_type: str = "external_trigger",
    blob: dict[str, Any] | None = None,
    is_deleted: bool = False,
    created_at: dt.datetime = T0,
    created_by: str = "alice",
) -> None:
    with maker() as session:
        session.add(
            ExperimentDefinition(
                experiment_definition_id=experiment_id,
                version=version,
                created_by=created_by,
                created_at=created_at,
                blueprint_id="bp",
                blueprint_version=3,
                experiment_type=experiment_type,
                experiment_definition=blob if blob is not None else {"source": "aviso", "event_type": "mars"},
                is_deleted=is_deleted,
            )
        )
        session.commit()


def test_claim_then_duplicate(session_maker: sessionmaker[Session]) -> None:
    assert trigger_db.claim_event(EXP, _event()) is True
    assert trigger_db.claim_event(EXP, _event()) is False
    events = trigger_db.list_events(EXP, limit=10)
    assert len(events) == 1
    assert events[0].status == "claimed"
    assert events[0].run_id is None
    assert events[0].published_at == T0


def test_claim_distinguishes_source_type_experiment_sequence(session_maker: sessionmaker[Session]) -> None:
    assert trigger_db.claim_event(EXP, _event(5))
    assert trigger_db.claim_event(EXP, _event(5, source="synthetic"))
    assert trigger_db.claim_event(EXP, _event(5, event_type="other"))
    assert trigger_db.claim_event(ExperimentDefinitionId("exp-2"), _event(5))
    assert trigger_db.claim_event(EXP, _event(6))
    assert not trigger_db.claim_event(EXP, _event(5))
    assert len(trigger_db.list_events(EXP, limit=10)) == 4


def test_claim_skipped_stale_and_invalid_status(session_maker: sessionmaker[Session]) -> None:
    assert trigger_db.claim_event(EXP, _event(), status="skipped_stale")
    assert trigger_db.list_events(EXP, limit=1)[0].status == "skipped_stale"
    with pytest.raises(ValueError):
        trigger_db.claim_event(EXP, _event(2), status="submitted")  # ty:ignore[invalid-argument-type]


def test_claim_normalises_published_at_to_utc(session_maker: sessionmaker[Session]) -> None:
    offset = dt.timezone(dt.timedelta(hours=2))
    assert trigger_db.claim_event(EXP, _event(published_at=dt.datetime(2026, 11, 3, 14, 0, tzinfo=offset)))
    assert trigger_db.list_events(EXP, limit=1)[0].published_at == T0


def test_finish_event(session_maker: sessionmaker[Session]) -> None:
    event = _event()
    trigger_db.claim_event(EXP, event)
    trigger_db.claim_event(EXP, _event(2))
    trigger_db.finish_event(EXP, event, "submitted", run_id="run-9")
    by_sequence = {r.sequence: r for r in trigger_db.list_events(EXP, limit=10)}
    assert by_sequence[1].status == "submitted"
    assert by_sequence[1].run_id == "run-9"
    assert by_sequence[1].message is None
    assert by_sequence[1].updated_at >= by_sequence[1].created_at
    assert by_sequence[2].status == "claimed"

    trigger_db.finish_event(EXP, event, "failed", message="boom")
    record = trigger_db.list_events(EXP, limit=10)[1]
    assert (record.status, record.run_id, record.message) == ("failed", None, "boom")


def test_finish_event_truncates_message(session_maker: sessionmaker[Session]) -> None:
    event = _event()
    trigger_db.claim_event(EXP, event)
    trigger_db.finish_event(EXP, event, "failed", message="x" * 5000)
    message = trigger_db.list_events(EXP, limit=1)[0].message
    assert message is not None
    assert len(message) == trigger_db.MESSAGE_MAX_LENGTH


def test_finish_event_missing_row_warns(session_maker: sessionmaker[Session], caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        trigger_db.finish_event(EXP, _event(), "failed", message="x")
    assert "no handled-event row" in caplog.text
    assert trigger_db.list_events(EXP, limit=10) == []


def test_finish_event_rejects_claimed(session_maker: sessionmaker[Session]) -> None:
    with pytest.raises(ValueError):
        trigger_db.finish_event(EXP, _event(), "claimed")  # ty:ignore[invalid-argument-type]


def test_list_events_order_and_paging(session_maker: sessionmaker[Session]) -> None:
    # claimed out of sequence order, listing follows claim order, newest first
    for sequence in (3, 1, 2, 5, 4):
        trigger_db.claim_event(EXP, _event(sequence))
    trigger_db.claim_event(ExperimentDefinitionId("other"), _event(99))
    assert [r.sequence for r in trigger_db.list_events(EXP, limit=10)] == [4, 5, 2, 1, 3]
    assert [r.sequence for r in trigger_db.list_events(EXP, limit=2)] == [4, 5]
    assert [r.sequence for r in trigger_db.list_events(EXP, limit=2, offset=2)] == [2, 1]
    assert trigger_db.list_events(ExperimentDefinitionId("none"), limit=10) == []


def test_count_stuck_claims(session_maker: sessionmaker[Session]) -> None:
    now = dt.datetime.now(dt.UTC)
    for sequence in (1, 2, 3, 4):
        trigger_db.claim_event(EXP, _event(sequence))
    trigger_db.finish_event(EXP, _event(2), "submitted", run_id="r")
    trigger_db.claim_event(EXP, _event(5), status="skipped_stale")
    with session_maker() as session:
        session.execute(
            update(ExperimentTriggerEvent)
            .where(ExperimentTriggerEvent.sequence.in_([1, 2, 5]))
            .values(created_at=now - dt.timedelta(hours=1))
        )
        session.commit()
    # 1 is old and claimed; 2 is old but submitted; 3 and 4 are claimed but recent; 5 is old but skipped
    assert trigger_db.count_stuck_claims(now - dt.timedelta(minutes=10)) == 1
    assert trigger_db.count_stuck_claims(now + dt.timedelta(minutes=1)) == 3
    assert trigger_db.count_stuck_claims(now - dt.timedelta(hours=2)) == 0


def test_list_active_triggers(session_maker: sessionmaker[Session], caplog: pytest.LogCaptureFixture) -> None:
    v1_time = T0
    v2_time = T0 + dt.timedelta(hours=1)
    _add_definition(session_maker, "a", 1, blob={"event_type": "old"}, created_at=v1_time)
    _add_definition(
        session_maker,
        "a",
        2,
        blob={"event_type": "mars", "filter": {"class": "od"}, "glyph_map": {"date": "forecastDate"}, "enabled": False},
        created_at=v2_time,
        created_by="bob",
    )
    _add_definition(session_maker, "b", 1, blob={"event_type": "dis"})
    _add_definition(session_maker, "cron", 1, experiment_type="cron_schedule", blob={"cron_expr": "* * * * *"})
    _add_definition(session_maker, "deleted", 1, is_deleted=True)
    _add_definition(session_maker, "bad", 1, blob={"event_type": ""})
    _add_definition(session_maker, "bad2", 1, blob={"unknown_field": 1, "event_type": "x"})

    with caplog.at_level(logging.ERROR):
        triggers = trigger_db.list_active_triggers()

    assert [t.experiment_id for t in triggers] == ["a", "b"]
    a, b = triggers
    assert a.version == 2
    assert a.created_by == "bob"
    assert a.created_at == v2_time
    assert (a.blueprint_id, a.blueprint_version) == ("bp", 3)
    assert a.spec.event_type == "mars"
    assert a.spec.filter == {"class": "od"}
    assert a.spec.glyph_map == {"date": "forecastDate"}
    assert a.spec.enabled is False
    assert b.spec.event_type == "dis"
    assert "experiment=bad " in caplog.text
    assert "experiment=bad2 " in caplog.text


def test_list_active_triggers_empty_and_all_deleted(session_maker: sessionmaker[Session]) -> None:
    assert trigger_db.list_active_triggers() == []
    _add_definition(session_maker, "a", 1)
    _add_definition(session_maker, "a", 2)
    assert [t.version for t in trigger_db.list_active_triggers()] == [2]
    # soft deletion marks every version of the entity
    with session_maker() as session:
        session.execute(update(ExperimentDefinition).values(is_deleted=True))
        session.commit()
    assert trigger_db.list_active_triggers() == []


def test_concurrent_double_claim_exactly_one_wins(session_maker: sessionmaker[Session]) -> None:
    n_threads = 8
    for round_ in range(5):
        event = _event(sequence=100 + round_)
        barrier = threading.Barrier(n_threads)
        results: list[bool] = []
        errors: list[BaseException] = []

        def worker() -> None:
            try:
                barrier.wait()
                results.append(trigger_db.claim_event(EXP, event))
            except BaseException as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not errors
        assert sorted(results) == [False] * (n_threads - 1) + [True]
    assert len(trigger_db.list_events(EXP, limit=100)) == 5
