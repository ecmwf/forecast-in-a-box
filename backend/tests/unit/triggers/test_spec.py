# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the trigger spec and event-to-glyph mapping."""

import datetime as dt

import pytest
from pydantic import ValidationError

from forecastbox.domain.experiment.triggers.spec import (
    AvisoEvent,
    TriggerEventError,
    TriggerSpec,
    event2context,
    event2glyphs,
    is_stale,
    replay_start,
)
from forecastbox.domain.glyphs.intrinsic import get_values_and_examples

NOW = dt.datetime(2026, 11, 3, 12, 0, 0, tzinfo=dt.UTC)


def _event(
    identifier: dict[str, str | int | float | list[str]] | None = None,
    *,
    source: str = "aviso",
    event_type: str = "mars",
    sequence: int = 1234,
    published_at: dt.datetime = NOW,
) -> AvisoEvent:
    return AvisoEvent(
        source=source,  # ty:ignore[invalid-argument-type]
        event_type=event_type,
        sequence=sequence,
        identifier={} if identifier is None else identifier,
        payload=None,
        published_at=published_at,
    )


def _spec(**kwargs: object) -> TriggerSpec:
    return TriggerSpec.model_validate({"event_type": "mars", **kwargs})


# --- TriggerSpec ---


def test_spec_defaults() -> None:
    spec = _spec()
    assert spec.source == "aviso"
    assert spec.filter == {}
    assert spec.glyph_map == {}
    assert spec.max_acceptable_delay_hours == 24
    assert spec.enabled is True


def test_spec_rejects_empty_event_type() -> None:
    with pytest.raises(ValidationError):
        TriggerSpec.model_validate({"event_type": ""})


def test_spec_rejects_unknown_source_and_extra_fields() -> None:
    with pytest.raises(ValidationError):
        _spec(source="other")
    with pytest.raises(ValidationError):
        _spec(unknown=1)


@pytest.mark.parametrize("hours", [0, -1])
def test_spec_rejects_non_positive_delay(hours: int) -> None:
    with pytest.raises(ValidationError):
        _spec(max_acceptable_delay_hours=hours)


@pytest.mark.parametrize("target", ["", "1abc", "has space", "a-b", "aviso_foo", "aviso_", "timedelta", "floor_day"])
def test_spec_rejects_invalid_glyph_targets(target: str) -> None:
    with pytest.raises(ValidationError):
        _spec(glyph_map={"date": target})


def test_spec_rejects_intrinsic_glyph_target() -> None:
    intrinsic = next(iter(get_values_and_examples()))
    with pytest.raises(ValidationError):
        _spec(glyph_map={"date": intrinsic})


def test_spec_accepts_valid_glyph_target() -> None:
    assert _spec(glyph_map={"date": "forecastDate"}).glyph_map == {"date": "forecastDate"}


# --- event2glyphs ---


def test_event2glyphs_scalar_fields_and_metadata() -> None:
    event = _event({"class": "od", "step": 6, "x": 1.5}, sequence=7)
    glyphs = event2glyphs(_spec(), event)
    assert glyphs == {
        "aviso_class": "od",
        "aviso_step": "6",
        "aviso_x": "1.5",
        "aviso_sequence": "7",
        "aviso_event_type": "mars",
        "aviso_published": "2026-11-03T12:00:00+00:00",
    }


def test_event2glyphs_skips_non_scalar() -> None:
    glyphs = event2glyphs(_spec(), _event({"class": "od", "area": ["1", "2"]}))
    assert "aviso_area" not in glyphs
    assert glyphs["aviso_class"] == "od"


def test_event2glyphs_sanitises_keys() -> None:
    glyphs = event2glyphs(_spec(), _event({"a-b.c d": "v"}))
    assert glyphs["aviso_a_b_c_d"] == "v"


def test_event2glyphs_key_collision() -> None:
    with pytest.raises(TriggerEventError):
        event2glyphs(_spec(), _event({"a-b": "1", "a.b": "2"}))


@pytest.mark.parametrize("key", ["sequence", "event_type", "published"])
def test_event2glyphs_metadata_collision(key: str) -> None:
    with pytest.raises(TriggerEventError):
        event2glyphs(_spec(), _event({key: "x"}))


def test_event2glyphs_non_scalar_does_not_collide() -> None:
    glyphs = event2glyphs(_spec(), _event({"a-b": ["1"], "a.b": "2"}))
    assert glyphs["aviso_a_b"] == "2"


def test_event2glyphs_glyph_map_copies_and_skips_missing() -> None:
    spec = _spec(glyph_map={"date": "forecastDate", "missing": "other", "area": "areaGlyph"})
    glyphs = event2glyphs(spec, _event({"date": "20260101", "area": ["1"]}))
    assert glyphs["forecastDate"] == "20260101"
    assert glyphs["aviso_date"] == "20260101"
    assert "other" not in glyphs
    assert "areaGlyph" not in glyphs


def test_event2glyphs_published_naive_treated_as_utc() -> None:
    event = _event(published_at=dt.datetime(2026, 11, 3, 12, 0, 0))
    assert event2glyphs(_spec(), event)["aviso_published"] == "2026-11-03T12:00:00+00:00"


# --- event2context ---


def test_event2context() -> None:
    assert event2context(_event()) == "aviso:mars#1234"
    assert event2context(_event(source="synthetic")) == "synthetic:mars#1234"


def test_event2context_truncated() -> None:
    assert len(event2context(_event(event_type="x" * 1000))) == 255


# --- is_stale ---


def test_is_stale() -> None:
    spec = _spec(max_acceptable_delay_hours=2)
    assert is_stale(spec, _event(published_at=NOW - dt.timedelta(hours=3)), NOW) is True
    assert is_stale(spec, _event(published_at=NOW - dt.timedelta(hours=2)), NOW) is False
    assert is_stale(spec, _event(published_at=NOW - dt.timedelta(minutes=5)), NOW) is False


# --- replay_start ---


def test_replay_start_window_later_than_creation() -> None:
    spec = _spec(max_acceptable_delay_hours=2)
    created = NOW - dt.timedelta(hours=10)
    assert replay_start(spec, created, NOW) == NOW - dt.timedelta(hours=2)


def test_replay_start_creation_later_than_window() -> None:
    spec = _spec(max_acceptable_delay_hours=24)
    created = NOW - dt.timedelta(hours=1)
    assert replay_start(spec, created, NOW) == created


def test_replay_start_naive_creation_treated_as_utc() -> None:
    spec = _spec(max_acceptable_delay_hours=24)
    created = dt.datetime(2026, 11, 3, 11, 0, 0)
    assert replay_start(spec, created, NOW) == created.replace(tzinfo=dt.UTC)
