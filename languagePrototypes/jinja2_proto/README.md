# Jinja2 Interpolation Prototype

String interpolation and expression evaluation using [Jinja2](https://jinja.palletsprojects.com/), configured with `${` / `}` delimiters instead of the default `{{` / `}}`.

## Syntax overview

Any `${...}` block is evaluated as a Jinja2 expression. Everything outside a block is passed through literally. Multiple blocks can appear in a single string.

```
"${var1} literal ${var2}"
```

Variables supplied as plain strings are auto-coerced to `datetime` objects when they match ISO 8601 format (`YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS`, or `YYYY-MM-DD`), so datetime filters and arithmetic work without explicit parsing.

---

## Supported operations

### Basic substitution

```python
resolve_expression("${var1} literal ${var2}", {"var1": "hello", "var2": "world"})
# → "hello literal world"
```

### Datetime addition / subtraction

Use the built-in `timedelta` global or the `add_days` / `sub_days` / `add_hours` filters:

```python
resolve_expression("${submitDatetime | add_days(1)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-16 06:00:00"

resolve_expression("${submitDatetime | sub_days(2)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-13 06:00:00"

resolve_expression("${submitDatetime | add_hours(6)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-15 12:00:00"

# timedelta is also available as a global for inline arithmetic:
resolve_expression("${submitDatetime + timedelta(days=1)}", {"submitDatetime": "2024-01-15 06:00:00"})
# → "2024-01-16 06:00:00"
```

### Datetime rounding

```python
resolve_expression("${submitDatetime | floor_day}", {"submitDatetime": "2024-01-15 06:30:00"})
# → "2024-01-15 00:00:00"

resolve_expression("${submitDatetime | floor_hour}", {"submitDatetime": "2024-01-15 06:45:00"})
# → "2024-01-15 06:00:00"
```

### String operations

Standard Jinja2 string filters work out of the box:

```python
resolve_expression("${myParam1 | upper}", {"myParam1": "hello_world"})
# → "HELLO_WORLD"

resolve_expression("${myParam1 | lower}", {"myParam1": "Hello"})
# → "hello"

resolve_expression("${myParam1 | split('_') | first}", {"myParam1": "hello_world"})
# → "hello"

resolve_expression("${myParam1 | replace('_', '-')}", {"myParam1": "hello_world"})
# → "hello-world"
```

### Arithmetic expressions

```python
resolve_expression("${42 ** 10}", {})
# → "17080198121677824"

resolve_expression("${1e10}", {})
# → "10000000000.0"

resolve_expression("${x * 2 + 1}", {"x": "7"})
# Note: plain numeric strings are NOT auto-coerced; cast explicitly: ${x | int * 2 + 1}
```

For numeric variables use Jinja2's `int` / `float` filters to convert:

```python
resolve_expression("${x | int * 2 + 1}", {"x": "7"})
# → "15"
```

### Chaining

```python
resolve_expression(
    "${submitDatetime | add_days(1) | floor_day}",
    {"submitDatetime": "2024-01-15 14:30:00"},
)
# → "2024-01-16 00:00:00"
```

---

## Custom filters reference

| Filter | Signature | Description |
|---|---|---|
| `floor_day` | `dt \| floor_day` | Truncate datetime to midnight |
| `floor_hour` | `dt \| floor_hour` | Truncate datetime to the start of the hour |
| `add_days` | `dt \| add_days(n)` | Add *n* days |
| `sub_days` | `dt \| sub_days(n)` | Subtract *n* days |
| `add_hours` | `dt \| add_hours(n)` | Add *n* hours |

All standard [Jinja2 built-in filters](https://jinja.palletsprojects.com/en/stable/templates/#builtin-filters) (`upper`, `lower`, `replace`, `split`, `join`, `int`, `float`, `round`, `abs`, `first`, `last`, `sort`, …) are available.

---

## `extract_glyphs` — variable name extraction

`extract_glyphs(raw)` parses the Jinja2 AST and returns the set of variable names referenced in all `${...}` blocks within `raw`. Filter names, globals (`timedelta`, `datetime`), and Jinja2 built-ins are excluded.

```python
from interpolation import extract_glyphs

extract_glyphs("${submitDatetime | add_days(1)} / ${myParam1 | upper}")
# → {"submitDatetime", "myParam1"}

extract_glyphs("${42 ** 10}")
# → set()

extract_glyphs("${a + b | floor_day}")
# → {"a", "b"}
```

---

## Portability

- **JavaScript**: [Nunjucks](https://mozilla.github.io/nunjucks/) is a close Jinja2 port. Standard filters map directly; custom filters (`floor_day`, `add_days`, …) would need reimplementing in JS.
- **Rust**: The [`minijinja`](https://crates.io/crates/minijinja) crate implements most of Jinja2. Custom filters are registered via `env.add_filter()`; the delimiter can be customised via `SyntaxConfig`.
