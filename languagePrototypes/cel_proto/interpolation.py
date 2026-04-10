"""String interpolation using Google CEL (Common Expression Language) via cel-python.

cel-python (celpy) provides a Python implementation of CEL with lark-based parsing.
Custom functions (upperAscii, lowerAscii, split) are registered to fill gaps in the
cel-python standard library implementation.  Datetime-like string variables are
auto-coerced to TimestampType so that CEL's native timestamp+duration arithmetic works
directly.
"""

import re

import celpy
import celpy.celtypes
import lark

_EXPR_RE = re.compile(r"\$\{([^}]+)\}")

# Datetime string patterns accepted for auto-coercion to TimestampType.
_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?Z?$"
    r"|^\d{4}-\d{2}-\d{2}$"
)

# CEL built-in identifiers that are *not* user variables.
_CEL_BUILTINS: frozenset[str] = frozenset(
    {
        "true",
        "false",
        "null",
        "timestamp",
        "duration",
        "int",
        "uint",
        "double",
        "string",
        "bool",
        "bytes",
        "list",
        "map",
        "type",
        "size",
        "contains",
        "startsWith",
        "endsWith",
        "matches",
        "getDate",
        "getDayOfMonth",
        "getDayOfWeek",
        "getDayOfYear",
        "getFullYear",
        "getMonth",
        "getHours",
        "getMilliseconds",
        "getMinutes",
        "getSeconds",
    }
)

# --- custom functions registered into every program ---


def _cel_upper_ascii(s: celpy.celtypes.StringType) -> celpy.celtypes.StringType:
    return celpy.celtypes.StringType(str(s).upper())


def _cel_lower_ascii(s: celpy.celtypes.StringType) -> celpy.celtypes.StringType:
    return celpy.celtypes.StringType(str(s).lower())


def _cel_split(
    s: celpy.celtypes.StringType, sep: celpy.celtypes.StringType
) -> celpy.celtypes.ListType:
    return celpy.celtypes.ListType(
        [celpy.celtypes.StringType(p) for p in str(s).split(str(sep))]
    )


_EXTRA_FUNCTIONS: dict[str, celpy.CELFunction] = {
    "upperAscii": _cel_upper_ascii,
    "lowerAscii": _cel_lower_ascii,
    "split": _cel_split,
}

_ENV = celpy.Environment()


def _coerce_value(value: str) -> celpy.celtypes.CELType:
    """Return a CEL type for *value*, promoting datetime-like strings to TimestampType."""
    if _DATETIME_RE.match(value):
        # Normalise separator and ensure Z suffix for RFC3339.
        normalised = value.replace(" ", "T")
        if not normalised.endswith("Z") and "." not in normalised:
            normalised += "Z"
        try:
            return celpy.celtypes.TimestampType(normalised)
        except Exception:
            pass
    return celpy.celtypes.StringType(value)


def _build_activation(variables: dict[str, str]) -> celpy.Context:
    return celpy.json_to_cel(
        {k: _coerce_value(v) for k, v in variables.items()}  # type: ignore[arg-type]
    )


def _format_result(result: celpy.celtypes.CELType) -> str:
    """Convert a CEL evaluation result to a plain string."""
    if isinstance(result, celpy.celtypes.TimestampType):
        # Emit RFC3339 UTC; str() already returns "YYYY-MM-DDTHH:MM:SSZ".
        return str(result)
    if isinstance(result, celpy.celtypes.BoolType):
        return "true" if result else "false"
    return str(result)


def resolve_expression(raw: str, variables: dict[str, str]) -> str:
    """Resolve all ${...} expressions in *raw*, substituting variables and evaluating expressions.

    Variables whose values look like datetimes are auto-coerced to CEL TimestampType so
    that timestamp+duration arithmetic works natively.  Returns the fully resolved string.
    """
    activation = _build_activation(variables)

    def _replace(match: re.Match[str]) -> str:
        expr_src = match.group(1)
        ast_node = _ENV.compile(expr_src)
        prog = _ENV.program(ast_node, functions=_EXTRA_FUNCTIONS)
        return _format_result(prog.evaluate(activation))

    return _EXPR_RE.sub(_replace, raw)


def _extract_idents_from_cel_ast(tree: lark.Tree) -> set[str]:
    """Walk the lark parse tree and return all primary-position identifiers.

    Identifiers that appear after a dot (method names in member_dot_arg) are *not*
    primary identifiers and are therefore excluded automatically because they never
    appear under a `primary > ident` subtree.
    """
    result: set[str] = set()
    for subtree in tree.iter_subtrees():
        if subtree.data == "primary":
            for child in subtree.children:
                if isinstance(child, lark.Tree) and child.data == "ident":
                    for token in child.children:
                        if isinstance(token, lark.Token) and token.type == "IDENT":
                            result.add(str(token))
    return result


def extract_glyphs(raw: str) -> set[str]:
    """Extract the set of variable names referenced in ${...} expressions within *raw*.

    CEL built-ins (timestamp, duration, true, false, …) are excluded.  Names provided
    via the custom function table (upperAscii, lowerAscii, split) are never primary
    identifiers in the AST and so are excluded automatically.
    """
    glyphs: set[str] = set()
    for match in _EXPR_RE.finditer(raw):
        try:
            ast_node = _ENV.compile(match.group(1))
        except celpy.CELParseError:
            continue
        for name in _extract_idents_from_cel_ast(ast_node):
            if name not in _CEL_BUILTINS:
                glyphs.add(name)
    return glyphs
