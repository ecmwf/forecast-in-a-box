"""String interpolation using simpleeval for safe Python expression evaluation."""

import ast
import re
from datetime import datetime, timedelta

from simpleeval import EvalWithCompoundTypes

_EXPR_RE = re.compile(r"\$\{([^}]+)\}")

_DATETIME_FMTS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%d",
]


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


_FUNCTIONS: dict[str, object] = {
    "uppercase": str.upper,
    "lowercase": str.lower,
    "floor_day": _floor_day,
    "floor_hour": _floor_hour,
    "add_days": _add_days,
    "sub_days": _sub_days,
    "timedelta": timedelta,
    "datetime": datetime,
}

_BUILTIN_NAMES: frozenset[str] = frozenset(_FUNCTIONS) | {
    "timedelta",
    "datetime",
    "True",
    "False",
    "None",
}


def _make_evaluator(variables: dict[str, str]) -> EvalWithCompoundTypes:
    names: dict[str, object] = _coerce_variables(variables)  # type: ignore[assignment]
    evaluator = EvalWithCompoundTypes(functions=_FUNCTIONS, names=names)  # type: ignore[arg-type]
    return evaluator


def resolve_expression(raw: str, variables: dict[str, str]) -> str:
    """Resolve all ${...} expressions in `raw`, substituting variables and evaluating expressions.

    Returns the fully resolved string. Variables whose values look like datetimes are
    auto-parsed into datetime objects so arithmetic works directly.
    """
    evaluator = _make_evaluator(variables)

    def _replace(match: re.Match[str]) -> str:
        result = evaluator.eval(match.group(1))
        if isinstance(result, datetime):
            return result.strftime("%Y-%m-%d %H:%M:%S")
        return str(result)

    return _EXPR_RE.sub(_replace, raw)


def extract_glyphs(raw: str) -> set[str]:
    """Extract the set of user-provided variable names referenced in ${...} expressions within `raw`.

    Names that correspond to built-in helpers or constants are excluded.
    """
    glyphs: set[str] = set()
    for match in _EXPR_RE.finditer(raw):
        try:
            tree = ast.parse(match.group(1), mode="eval")
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id not in _BUILTIN_NAMES:
                glyphs.add(node.id)
    return glyphs
