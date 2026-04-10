"""Lark-based string interpolation with a minimal custom expression language.

Public API:
    resolve_expression(raw, variables) -> str
    extract_glyphs(raw) -> set[str]
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from lark import Lark, Token, Transformer, v_args

# ---------------------------------------------------------------------------
# Grammar
# ---------------------------------------------------------------------------

GRAMMAR = r"""
    expression  : binary_expr

    // BIN_OP is a *named* terminal so it is retained in the parse tree.
    // Priority 2 ensures "**" matches before "*" and "//" before "/".
    binary_expr : unary_expr (BIN_OP unary_expr)*
    BIN_OP.2    : "**" | "//" | "+" | "-" | "*" | "/" | "%"

    unary_expr  : postfix_expr

    postfix_expr: primary_expr postfix*
    postfix     : "[" expression "]"             -> subscript
                | "." NAME "(" arglist? ")"      -> method_call

    primary_expr: "(" expression ")"             -> paren
                | NAME "(" arglist? ")"          -> func_call
                | NAME                           -> var_ref
                | number
                | string

    arglist     : arg ("," arg)*
    arg         : NAME "=" expression            -> kwarg
                | expression                     -> posarg

    number      : SIGNED_FLOAT | SIGNED_INT
    // Both double- and single-quoted string literals are supported.
    string      : ESCAPED_STRING | SINGLE_QUOTED
    SINGLE_QUOTED : "'" /([^'\\]|\\.)*/ "'"

    NAME        : /[a-zA-Z_][a-zA-Z0-9_]*/

    %import common.SIGNED_FLOAT
    %import common.SIGNED_INT
    %import common.ESCAPED_STRING
    %import common.WS
    %ignore WS
"""

_PARSER = Lark(GRAMMAR, start="expression", parser="earley")

# ---------------------------------------------------------------------------
# Built-ins available inside expressions
# ---------------------------------------------------------------------------

_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$")


def _coerce(value: str) -> Any:
    """Parse datetime strings; leave everything else as a plain string."""
    if _DATETIME_RE.match(value):
        return datetime.fromisoformat(value.replace(" ", "T"))
    return value


def _floor_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _split(s: str, sep: str, n: int | None = None) -> list[str]:
    return s.split(sep) if n is None else s.split(sep, n)


_BUILTINS: dict[str, Any] = {
    "timedelta": timedelta,
    "floor_day": _floor_day,
    "floor_hour": _floor_hour,
    "upper": str.upper,
    "lower": str.lower,
    "split": _split,
}

_BUILTIN_NAMES: frozenset[str] = frozenset(_BUILTINS)

# ---------------------------------------------------------------------------
# Transformer – walks the AST and computes values
# ---------------------------------------------------------------------------

_BINARY_OPS: dict[str, Any] = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: a / b,
    "**": lambda a, b: a**b,
    "%": lambda a, b: a % b,
    "//": lambda a, b: a // b,
}

# Sentinel to distinguish keyword arguments from positional values inside arglist.
class _KwArg:
    __slots__ = ("name", "value")

    def __init__(self, name: str, value: Any) -> None:
        self.name = name
        self.value = value


@v_args(inline=True)
class _Evaluator(Transformer):
    """Evaluate an expression tree given a variable context."""

    def __init__(self, variables: dict[str, Any]) -> None:
        super().__init__()
        self._vars = variables

    # --- leaves -----------------------------------------------------------

    def number(self, token: Token) -> int | float:
        text = str(token)
        return float(text) if "." in text or "e" in text.lower() else int(text)

    def string(self, token: Token) -> str:
        # ESCAPED_STRING includes surrounding quotes; strip and unescape them.
        return str(token)[1:-1].encode("raw_unicode_escape").decode("unicode_escape")

    def NAME(self, token: Token) -> str:  # noqa: N802  (Lark convention)
        return str(token)

    # --- variable / call references ---------------------------------------

    def var_ref(self, name: str) -> Any:
        if name in _BUILTINS:
            return _BUILTINS[name]
        return self._vars[name]

    def func_call(self, name: str, *call_args: Any) -> Any:
        fn = _BUILTINS.get(name)
        if fn is None:
            raise NameError(f"Unknown function: {name!r}")
        positional, keyword = call_args[0] if call_args else ([], {})
        return fn(*positional, **keyword)

    # --- postfix ----------------------------------------------------------

    def postfix_expr(self, primary: Any, *postfixes: Any) -> Any:
        result = primary
        for pf in postfixes:
            result = pf(result)
        return result

    def subscript(self, index: Any) -> Any:  # returns a callable applied in postfix_expr
        return lambda obj: obj[index]

    def method_call(self, name: str, *call_args: Any) -> Any:
        positional, keyword = call_args[0] if call_args else ([], {})

        def _apply(obj: Any) -> Any:
            return getattr(obj, name)(*positional, **keyword)

        return _apply

    # --- arguments --------------------------------------------------------

    def arglist(self, *args: Any) -> tuple[list[Any], dict[str, Any]]:
        positional = [a for a in args if not isinstance(a, _KwArg)]
        keyword = {a.name: a.value for a in args if isinstance(a, _KwArg)}
        return (positional, keyword)

    def posarg(self, value: Any) -> Any:
        return value

    def kwarg(self, name: str, value: Any) -> _KwArg:
        return _KwArg(name=str(name), value=value)

    # --- primary_expr passthrough -----------------------------------------
    # The `number` and `string` alternatives in primary_expr carry no alias,
    # so Lark wraps them in a Tree("primary_expr", [value]).  This unwraps it.

    def primary_expr(self, child: Any) -> Any:
        return child

    # --- parenthesised expression -----------------------------------------

    def paren(self, inner: Any) -> Any:
        return inner

    # --- binary expression ------------------------------------------------

    def binary_expr(self, *children: Any) -> Any:
        # Children alternate: value, BIN_OP token, value, BIN_OP token, value, ...
        result = children[0]
        it = iter(children[1:])
        for op_token, operand in zip(it, it):
            result = _BINARY_OPS[str(op_token)](result, operand)
        return result

    def unary_expr(self, value: Any) -> Any:
        return value

    def expression(self, value: Any) -> Any:
        return value


# ---------------------------------------------------------------------------
# Glyph collector – collects var_ref names that are not built-in functions
# ---------------------------------------------------------------------------


class _GlyphCollector(Transformer):
    """Walk the AST and accumulate variable names referenced via var_ref."""

    def __init__(self) -> None:
        super().__init__()
        self.glyphs: set[str] = set()

    def var_ref(self, children: list[Token]) -> None:
        name = str(children[0])
        if name not in _BUILTIN_NAMES:
            self.glyphs.add(name)


# ---------------------------------------------------------------------------
# Regex for finding ${...} blocks
# ---------------------------------------------------------------------------

# Non-greedy match of ${...}; handles nested braces naively (sufficient for
# well-formed expressions that don't contain stray braces in string literals).
_INTERPOLATION_RE = re.compile(r"\$\{([^}]*)\}")


def _iter_expressions(raw: str):
    """Yield (full_match, inner_expr) for each ${...} block in raw."""
    for m in _INTERPOLATION_RE.finditer(raw):
        yield m.group(0), m.group(1).strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_expression(raw: str, variables: dict[str, str]) -> str:
    """Resolve all ${...} expressions in *raw*, substituting variables and evaluating expressions.

    Variable values that look like ``YYYY-MM-DDTHH:MM:SS`` (or with a space
    separator) are automatically parsed into ``datetime.datetime`` objects
    before evaluation; others remain plain strings.  The final result of each
    expression is converted back to a string and substituted in place.
    """
    coerced: dict[str, Any] = {k: _coerce(v) for k, v in variables.items()}

    def _replace(m: re.Match) -> str:  # type: ignore[type-arg]
        inner = m.group(1).strip()
        tree = _PARSER.parse(inner)
        value = _Evaluator(coerced).transform(tree)
        return str(value)

    return _INTERPOLATION_RE.sub(_replace, raw)


def extract_glyphs(raw: str) -> set[str]:
    """Extract the set of variable names referenced in the expression(s) within *raw*.

    Built-in function names (``timedelta``, ``floor_day``, etc.) are excluded
    from the returned set; only user-supplied variable references are returned.
    """
    collector = _GlyphCollector()
    for _full, inner in _iter_expressions(raw):
        tree = _PARSER.parse(inner)
        collector.transform(tree)
    return collector.glyphs
