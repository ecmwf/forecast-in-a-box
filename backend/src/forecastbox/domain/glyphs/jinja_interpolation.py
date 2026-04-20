# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Jinja2-based string interpolation engine for ${...} glyph expressions.

Uses ``${`` / ``}`` as variable delimiters instead of the Jinja2 default ``{{`` / ``}}``.
Variables whose values match the canonical datetime format (``YYYY-MM-DD HH:MM:SS``) are
auto-coerced to :class:`datetime` objects so that date filters and arithmetic work directly.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from cascade.low.func import Either
from jinja2 import Environment, StrictUndefined, TemplateSyntaxError
from jinja2 import nodes as jnodes
from jinja2.sandbox import SandboxedEnvironment

# Only the canonical backend datetime format is auto-coerced; other date-like strings
# (e.g. "2024-01-15") are intentionally kept as strings to avoid silent format changes.
_CANONICAL_DATETIME_FMT = "%Y-%m-%d %H:%M:%S"


def _try_parse_datetime(value: str) -> datetime | str:
    try:
        return datetime.strptime(value, _CANONICAL_DATETIME_FMT)
    except ValueError:
        return value


def _coerce_variables(variables: dict[str, str]) -> dict[str, datetime | str]:
    return {k: _try_parse_datetime(v) for k, v in variables.items()}


def _floor_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _add_days(dt: datetime, days: int) -> datetime:
    return dt + timedelta(days=days)


def _sub_days(dt: datetime, days: int) -> datetime:
    return dt - timedelta(days=days)


def _add_hours(dt: datetime, hours: int) -> datetime:
    return dt + timedelta(hours=hours)


def _split(value: str, sep: str | None = None) -> list[str]:
    return value.split(sep)


def _stringify_result(value: object) -> str:
    if isinstance(value, datetime):
        return value.strftime(_CANONICAL_DATETIME_FMT)
    return str(value)


@dataclass(frozen=True)
class CustomFunction:
    """A named function registered in the Jinja2 interpolation environment.

    ``name`` is the keyword used in expressions (e.g. ``add_days``).
    ``implementation`` is the callable registered as a filter or global.
    ``description`` is a human-readable explanation shown via the API.
    ``kind`` is either ``"filter"`` (pipe syntax) or ``"global"`` (direct call).
    """

    name: str
    implementation: Callable[..., Any]
    description: str
    kind: str  # "filter" | "global"


CUSTOM_FUNCTIONS: list[CustomFunction] = [
    CustomFunction(
        name="floor_day",
        implementation=_floor_day,
        description="Truncate a datetime to midnight: ${dt | floor_day}",
        kind="filter",
    ),
    CustomFunction(
        name="floor_hour",
        implementation=_floor_hour,
        description="Truncate a datetime to the start of the hour: ${dt | floor_hour}",
        kind="filter",
    ),
    CustomFunction(
        name="add_days",
        implementation=_add_days,
        description="Add n days to a datetime: ${dt | add_days(n)}",
        kind="filter",
    ),
    CustomFunction(
        name="sub_days",
        implementation=_sub_days,
        description="Subtract n days from a datetime: ${dt | sub_days(n)}",
        kind="filter",
    ),
    CustomFunction(
        name="add_hours",
        implementation=_add_hours,
        description="Add n hours to a datetime: ${dt | add_hours(n)}",
        kind="filter",
    ),
    CustomFunction(
        name="split",
        implementation=_split,
        description="Split a string on a separator: ${s | split('_')}",
        kind="filter",
    ),
    CustomFunction(
        name="timedelta",
        implementation=timedelta,
        description="Python timedelta constructor, for inline arithmetic: ${dt + timedelta(days=1)}",
        kind="global",
    ),
    CustomFunction(
        name="datetime",
        implementation=datetime,
        description="Python datetime constructor: ${datetime(2024, 1, 15)}",
        kind="global",
    ),
]


def _make_env() -> SandboxedEnvironment:
    env = SandboxedEnvironment(
        variable_start_string="${",
        variable_end_string="}",
        block_start_string="${%",
        block_end_string="%}",
        comment_start_string="${#",
        comment_end_string="#}",
        keep_trailing_newline=True,
        undefined=StrictUndefined,
    )
    for fn in CUSTOM_FUNCTIONS:
        if fn.kind == "filter":
            env.filters[fn.name] = fn.implementation
        else:
            env.globals[fn.name] = fn.implementation
    env.finalize = _stringify_result  # type: ignore[method-assign]
    return env


_ENV = _make_env()

# Names that are part of the jinja2 environment (filters + globals) rather than user variables.
_FILTER_NAMES: frozenset[str] = frozenset(_ENV.filters) | frozenset(_ENV.globals)


def get_custom_functions() -> list[CustomFunction]:
    """Return all custom functions registered in the interpolation environment."""
    return list(CUSTOM_FUNCTIONS)


def render_expression(raw: str, variables: dict[str, str]) -> str:
    """Render ``raw`` as a Jinja2 template, substituting ``${...}`` expressions.

    Variable values matching the canonical datetime format are auto-coerced to
    :class:`datetime` so that date arithmetic and filters work directly.

    Raises :class:`jinja2.UndefinedError` if any referenced variable is absent from
    ``variables``, and :class:`jinja2.TemplateSyntaxError` if ``raw`` is malformed.
    """
    template = _ENV.from_string(raw)
    ctx: dict[str, object] = {**_coerce_variables(variables)}
    return template.render(ctx)


def _collect_glyph_names(node: jnodes.Node, glyphs: set[str]) -> None:
    if isinstance(node, jnodes.Name) and node.ctx == "load" and node.name not in _FILTER_NAMES:
        glyphs.add(node.name)
    for child in node.iter_child_nodes():
        _collect_glyph_names(child, glyphs)


def extract_glyph_names(raw: str) -> Either[set[str], str]:  # type: ignore[invalid-argument]
    """Extract variable names from ``${...}`` expressions in ``raw`` using the Jinja2 AST.

    Returns ``Either.ok(names)`` on success and ``Either.error(message)`` if the template
    contains a syntax error.  Filter names, globals (``timedelta``, ``datetime``), and
    built-in Jinja2 names are excluded from the returned set.
    """
    # Normalise ${expr} → {{ expr }} so we can parse with a standard-delimiter environment.
    normalised = re.sub(r"\$\{([^}]+)\}", r"{{ \1 }}", raw)
    parse_env = Environment()
    try:
        ast = parse_env.parse(normalised)
    except TemplateSyntaxError as exc:
        return Either.error(str(exc))

    glyphs: set[str] = set()
    _collect_glyph_names(ast, glyphs)
    return Either.ok(glyphs - _FILTER_NAMES)
