"""String interpolation using Jinja2 with ${...} delimiters."""

import re
from datetime import datetime, timedelta

from jinja2 import Environment
from jinja2 import nodes as jnodes
from jinja2.sandbox import SandboxedEnvironment

_DATETIME_FMTS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%d",
]

_EXPR_RE = re.compile(r"\$\{[^}]+\}")


def _try_parse_datetime(value: str) -> datetime | str:
    for fmt in _DATETIME_FMTS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
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


def _fmt_datetime(dt: datetime | str) -> str:
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)


def _make_env() -> Environment:
    env = SandboxedEnvironment(
        variable_start_string="${",
        variable_end_string="}",
        block_start_string="${%",
        block_end_string="%}",
        comment_start_string="${#",
        comment_end_string="#}",
        keep_trailing_newline=True,
    )
    env.filters["floor_day"] = _floor_day
    env.filters["floor_hour"] = _floor_hour
    env.filters["add_days"] = _add_days
    env.filters["sub_days"] = _sub_days
    env.filters["add_hours"] = _add_hours
    env.filters["split"] = _split
    env.globals["timedelta"] = timedelta
    env.globals["datetime"] = datetime
    return env


_ENV = _make_env()

_FILTER_NAMES: frozenset[str] = frozenset(_ENV.filters) | frozenset(_ENV.globals)


def _stringify_result(value: object) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _patch_finalize(env: Environment) -> None:
    env.finalize = _stringify_result  # type: ignore[method-assign]


_patch_finalize(_ENV)


def resolve_expression(raw: str, variables: dict[str, str]) -> str:
    """Resolve all ${...} expressions in `raw`, substituting variables and evaluating expressions.

    Variables whose values look like ISO datetimes are auto-parsed into datetime objects
    so arithmetic and date filters work directly. Returns the fully resolved string.
    """
    template = _ENV.from_string(raw)
    ctx: dict[str, object] = {**_coerce_variables(variables)}
    return template.render(ctx)


def _collect_glyphs(node: jnodes.Node, glyphs: set[str]) -> None:
    if isinstance(node, jnodes.Name) and node.ctx == "load" and node.name not in _FILTER_NAMES:
        glyphs.add(node.name)
    for child in node.iter_child_nodes():
        _collect_glyphs(child, glyphs)


def extract_glyphs(raw: str) -> set[str]:
    """Extract the set of variable names referenced in ${...} expressions within `raw`.

    Only returns names that look like user-provided variables (not filter names, globals,
    or Jinja2 built-ins).
    """
    # Wrap each ${expr} as {{ expr }} so we can parse it with a standard-delimiter env
    normalised = re.sub(r"\$\{([^}]+)\}", r"{{ \1 }}", raw)
    parse_env = Environment()
    try:
        ast = parse_env.parse(normalised)
    except Exception:
        return set()

    glyphs: set[str] = set()
    _collect_glyphs(ast, glyphs)
    # Exclude names that are jinja2 globals/tests/filters in our custom env
    return glyphs - _FILTER_NAMES
