# simpleeval interpolation prototype

A string interpolation / expression system built on [`simpleeval`](https://github.com/danthedeckie/simpleeval) — a safe subset of the Python AST evaluator.

## Syntax

Expressions are embedded in strings using `${...}`. Everything inside the braces is evaluated as a Python expression.

```
"prefix ${expression} suffix"
```

Multiple `${...}` blocks may appear in a single string.

---

## Supported operations

### Basic substitution

```python
resolve_expression("${var1} literal ${var2}", {"var1": "hello", "var2": "world"})
# → "hello literal world"
```

### Datetime arithmetic

Variables whose values look like datetime strings (`"2024-01-15 06:00:00"` or ISO format) are automatically parsed into `datetime` objects. `timedelta` is available in the evaluation context.

```python
resolve_expression(
    "${submitDatetime + timedelta(days=1)}",
    {"submitDatetime": "2024-01-15 06:00:00"},
)
# → "2024-01-16 06:00:00"
```

### Datetime rounding

`floor_day(dt)` truncates to midnight; `floor_hour(dt)` truncates to the start of the hour.

```python
resolve_expression("${floor_day(submitDatetime)}", {"submitDatetime": "2024-01-15 13:45:00"})
# → "2024-01-15 00:00:00"

resolve_expression("${floor_hour(submitDatetime)}", {"submitDatetime": "2024-01-15 13:45:00"})
# → "2024-01-15 13:00:00"
```

Day helpers are also available:

```python
resolve_expression("${add_days(submitDatetime, 3)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-18 06:00:00"

resolve_expression("${sub_days(submitDatetime, 1)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-14 06:00:00"
```

### String operations

```python
resolve_expression("${uppercase(myParam1)}", {"myParam1": "hello"})
# → "HELLO"

resolve_expression("${lowercase(myParam1)}", {"myParam1": "HELLO"})
# → "hello"

resolve_expression("${myParam1.split('_', 1)[0]}", {"myParam1": "model_run"})
# → "model"
```

### Arithmetic

```python
resolve_expression("${42 ** 10}", {})
# → "17080198121677824"

resolve_expression("${1e10}", {})
# → "10000000000.0"

resolve_expression("${x * 2 + 1}", {"x": "5"})   # x is a string; won't coerce automatically
# use timedelta/datetime helpers for numeric datetime offsets instead
```

### Chained operations

```python
resolve_expression(
    "run_${floor_day(submitDatetime + timedelta(days=1))}",
    {"submitDatetime": "2024-01-15 13:00:00"},
)
# → "run_2024-01-16 00:00:00"
```

---

## `extract_glyphs`

Returns the set of **user-provided variable names** referenced in `${...}` blocks, excluding built-in helpers and constants (`timedelta`, `datetime`, `floor_day`, `floor_hour`, `add_days`, `sub_days`, `uppercase`, `lowercase`, `True`, `False`, `None`).

```python
extract_glyphs("${submitDatetime + timedelta(days=1)} ${model}")
# → {"submitDatetime", "model"}

extract_glyphs("${floor_day(submitDatetime)}")
# → {"submitDatetime"}

extract_glyphs("${42 ** 10}")
# → set()
```

---

## Built-in names and functions

| Name | Type | Description |
|------|------|-------------|
| `timedelta` | name | `datetime.timedelta` constructor |
| `datetime` | name | `datetime.datetime` constructor |
| `floor_day(dt)` | function | Truncate datetime to midnight |
| `floor_hour(dt)` | function | Truncate datetime to start of hour |
| `add_days(dt, n)` | function | Add `n` days to datetime |
| `sub_days(dt, n)` | function | Subtract `n` days from datetime |
| `uppercase(s)` | function | `str.upper` |
| `lowercase(s)` | function | `str.lower` |

---

## Portability note

This implementation relies on `simpleeval`, which evaluates a **safe subset of the Python AST**. The expression syntax is deliberately Pythonic (method calls, subscripts, keyword arguments, etc.).

Porting to another runtime (e.g. Rust, JavaScript) would require either:
- embedding a Python interpreter (via PyO3 / Pyodide), or
- reimplementing the evaluator against the same Python AST grammar.

The implementation is intentionally simple and self-contained in a single file, making the semantics easy to read and replicate, but the syntax is not natively portable.
