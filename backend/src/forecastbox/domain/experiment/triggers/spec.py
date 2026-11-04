# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Trigger specification of an external-trigger experiment, the neutral event
representation, and the mapping of an event to glyph values.

Times handled here are timezone-aware UTC.  Naive datetimes passed to the helpers
are interpreted as UTC, matching the `UTCDateTime` column type used for stored times.
"""

import datetime as dt
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import Field, field_validator

from forecastbox.domain.glyphs.validation import validate_glyph
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

AVISO_GLYPH_PREFIX = "aviso_"
SEQUENCE_GLYPH = "aviso_sequence"
EVENT_TYPE_GLYPH = "aviso_event_type"
PUBLISHED_GLYPH = "aviso_published"
_METADATA_GLYPHS = frozenset({SEQUENCE_GLYPH, EVENT_TYPE_GLYPH, PUBLISHED_GLYPH})

CONTEXT_MAX_LENGTH = 255

_GLYPH_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_UNSAFE_CHAR_RE = re.compile(r"[^A-Za-z0-9_]")

EventSource = Literal["aviso", "synthetic"]
IdentifierValue = str | int | float | list[str]


class TriggerEventError(Exception):
    """Raised when an event cannot be converted to glyphs, or is malformed."""


class TriggerSpec(FiabBaseModel):
    """Stored configuration of an Aviso trigger.  The `glyph_map` maps an identifier
    field name of the event to the name of a glyph filled with its value."""

    source: Literal["aviso"] = "aviso"
    event_type: str = Field(min_length=1)
    filter: dict[str, object] = Field(default_factory=dict)
    glyph_map: dict[str, str] = Field(default_factory=dict)
    max_acceptable_delay_hours: int = Field(default=24, gt=0)
    enabled: bool = True

    @field_validator("glyph_map")
    @classmethod
    def _validate_glyph_targets(cls, value: dict[str, str]) -> dict[str, str]:
        for target in value.values():
            if not _GLYPH_NAME_RE.fullmatch(target):
                raise ValueError(f"glyph name {target!r} is not a valid identifier")
            if target.startswith(AVISO_GLYPH_PREFIX):
                raise ValueError(f"glyph name {target!r} uses the reserved prefix {AVISO_GLYPH_PREFIX!r}")
            validation = validate_glyph(target)
            if validation.e is not None:
                raise ValueError(f"glyph name {target!r} is invalid: {validation.e}")
        return value


@dataclass(frozen=True, eq=True, slots=True)
class AvisoEvent:
    """A neutral event notification.  The `source` is `synthetic` for events not
    originating from the Aviso service."""

    source: EventSource
    event_type: str
    sequence: int
    identifier: dict[str, IdentifierValue]
    payload: dict[str, object] | None
    published_at: dt.datetime


def _as_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def _is_scalar(value: object) -> bool:
    return isinstance(value, str | int | float)


def event2glyphs(spec: TriggerSpec, event: AvisoEvent) -> dict[str, str]:
    """Convert the event to string-valued glyphs.  Every scalar identifier field becomes
    `aviso_<key>` with non-alphanumeric characters of the key replaced by underscores,
    and `aviso_sequence`, `aviso_event_type` and `aviso_published` carry the metadata.
    Each `glyph_map` source present as a scalar identifier field is additionally set
    under its target name.  Raises `TriggerEventError` when two keys, or a key and a
    metadata glyph, produce the same glyph name."""
    glyphs: dict[str, str] = {
        SEQUENCE_GLYPH: str(event.sequence),
        EVENT_TYPE_GLYPH: event.event_type,
        PUBLISHED_GLYPH: value_dt2str(_as_utc(event.published_at)),
    }
    origins: dict[str, str] = {}
    for key, value in event.identifier.items():
        if not _is_scalar(value):
            continue
        name = AVISO_GLYPH_PREFIX + _UNSAFE_CHAR_RE.sub("_", key)
        if name in _METADATA_GLYPHS:
            raise TriggerEventError(f"identifier key {key!r} maps to the metadata glyph {name!r}")
        if name in origins:
            raise TriggerEventError(f"identifier keys {origins[name]!r} and {key!r} both map to the glyph {name!r}")
        origins[name] = key
        glyphs[name] = str(value)

    for source, target in spec.glyph_map.items():
        value = event.identifier.get(source)
        if value is not None and _is_scalar(value):
            glyphs[target] = str(value)
    return glyphs


def event2context(event: AvisoEvent) -> str:
    """Return a short deduplication context of the form `<source>:<event_type>#<sequence>`,
    truncated to 255 characters."""
    return f"{event.source}:{event.event_type}#{event.sequence}"[:CONTEXT_MAX_LENGTH]


def is_stale(spec: TriggerSpec, event: AvisoEvent, now: dt.datetime) -> bool:
    """Whether the event was published more than `max_acceptable_delay_hours` before `now`."""
    return _as_utc(now) - _as_utc(event.published_at) > dt.timedelta(hours=spec.max_acceptable_delay_hours)


def replay_start(spec: TriggerSpec, version_created_at: dt.datetime, now: dt.datetime) -> dt.datetime:
    """Return the earliest publication time from which missed events are replayed -- the
    later of `now` minus the acceptable delay and the creation time of the trigger version."""
    window_start = _as_utc(now) - dt.timedelta(hours=spec.max_acceptable_delay_hours)
    return max(window_start, _as_utc(version_created_at))
