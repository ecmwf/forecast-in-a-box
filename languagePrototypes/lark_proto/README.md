# Lark interpolation prototype

A minimal custom expression language embedded in string templates via `${...}` blocks.
The grammar is defined in EBNF and parsed by the [`lark`](https://github.com/lark-parser/lark) library;
the resulting parse tree is evaluated by a Lark `Transformer`.

## API

```python
from interpolation import resolve_expression, extract_glyphs

# Substitute and evaluate every ${...} block in `raw`.
result: str = resolve_expression(raw, variables)

# Collect all variable names (non-built-in) referenced in `raw`.
names: set[str] = extract_glyphs(raw)
```

`variables` is a plain `dict[str, str]`.  Values that match
`YYYY-MM-DD HH:MM:SS` (or the ISO-8601 `T` separator) are automatically
promoted to `datetime.datetime` before evaluation; all others remain strings.

## Grammar (informal)

```
expression  ::= binary_expr
binary_expr ::= unary_expr ( ("+" | "-" | "*" | "/" | "**" | "%" | "//") unary_expr )*
unary_expr  ::= postfix_expr
postfix_expr::= primary_expr ( "[" expression "]"  |  "." NAME "(" arglist? ")" )*
primary_expr::= "(" expression ")"
              | NAME "(" arglist? ")"      -- function call
              | NAME                       -- variable reference
              | number
              | string
arglist     ::= arg ("," arg)*
arg         ::= NAME "=" expression        -- keyword argument
              | expression                 -- positional argument
number      ::= SIGNED_FLOAT | SIGNED_INT
string      ::= ESCAPED_STRING             -- double- or single-quoted, backslash-escaped
NAME        ::= /[a-zA-Z_][a-zA-Z0-9_]*/
```

## Built-in functions

| Name | Signature | Description |
|------|-----------|-------------|
| `timedelta` | `timedelta(days=…, hours=…, …)` | `datetime.timedelta` constructor |
| `floor_day` | `floor_day(dt)` | Truncate datetime to midnight |
| `floor_hour` | `floor_hour(dt)` | Truncate datetime to the current hour |
| `upper` | `upper(s)` | Convert string to uppercase |
| `lower` | `lower(s)` | Convert string to lowercase |
| `split` | `split(s, sep[, n])` | Split string; returns a list |

## Examples

### Basic variable substitution

```python
resolve_expression("${var1} literal ${var2}", {"var1": "hello", "var2": "world"})
# → "hello literal world"
```

### Datetime arithmetic

```python
resolve_expression(
    "${submitDatetime + timedelta(days=1)}",
    {"submitDatetime": "2024-03-15 06:00:00"},
)
# → "2024-03-16 06:00:00"
```

### Round down to midnight

```python
resolve_expression(
    "${floor_day(submitDatetime)}",
    {"submitDatetime": "2024-03-15 06:00:00"},
)
# → "2024-03-15 00:00:00"
```

### String built-ins

```python
resolve_expression("${upper(myParam1)}", {"myParam1": "hello"})
# → "HELLO"

resolve_expression("${lower(myParam1)}", {"myParam1": "WORLD"})
# → "world"
```

### Method call + subscript

```python
resolve_expression("${myParam1.split('_', 1)[0]}", {"myParam1": "ERA5_daily"})
# → "ERA5"
```

### Arithmetic

```python
resolve_expression("${42 ** 10}", {})
# → "17080198121677824"

resolve_expression("${1e10}", {})
# → "10000000000.0"

resolve_expression("${(a + b) * c}", {"a": "2", "b": "3", "c": "4"})
# → "20"  (strings are used as-is; the caller should coerce if needed)
```

### Extracting referenced variable names

```python
extract_glyphs("${submitDatetime + timedelta(days=1)} and ${upper(myParam1)}")
# → {"submitDatetime", "myParam1"}
```

`timedelta` and `upper` are built-in names and are excluded from the result.

## Portability

The grammar is expressed in a portable EBNF subset.  Lark itself can emit a
standalone parser, but more importantly the grammar can be hand-translated to
other parsing frameworks with minimal effort:

- **Rust** — [`pest`](https://pest.rs) PEG grammar (very close 1-to-1 mapping)
- **JavaScript** — [`nearley`](https://nearley.js.org) or [`ohm`](https://ohmjs.org)
- **Go** — [`participle`](https://github.com/alecthomas/participle)

Only the transformer/evaluator (the Python-specific part) needs to be
reimplemented; the grammar itself is language-agnostic.
