# CEL Interpolation Prototype

This prototype implements the `${...}` string interpolation syntax using
[Google CEL (Common Expression Language)](https://cel.dev) via the
[cel-python](https://github.com/cloud-custodian/cel-python) library (`celpy`).

## Overview

CEL is a safe, fast, non-Turing-complete expression language originally designed
by Google for use in security policies, Kubernetes admission webhooks, and
Firebase rules.  It is intentionally sandboxed — no I/O, no loops, no arbitrary
code execution.

### Portability

CEL has **official** implementations in Go, Java, and C++.  The
[cel-python](https://github.com/cloud-custodian/cel-python) library provides a
Python implementation.  JavaScript support exists via
[@buf-build/cel](https://www.npmjs.com/package/@buf-build/cel).  This is the
strongest cross-language portability story of all approaches explored in this
prototype series.

---

## Syntax

Expressions are embedded in a string using `${...}`:

```
"prefix ${expression} suffix"
```

Multiple `${...}` segments may appear in a single string.

---

## Examples

### Basic variable substitution

```python
resolve_expression("Hello ${name}!", {"name": "world"})
# → "Hello world!"

resolve_expression("${a} / ${b}", {"a": "foo", "b": "bar"})
# → "foo / bar"
```

### Arithmetic

CEL supports `+`, `-`, `*`, `/` (integer floor division), `%`:

```python
resolve_expression("${42 * 10}", {})          # → "420"
resolve_expression("${10 / 3}", {})           # → "3"   (integer floor division)
resolve_expression("${10 % 3}", {})           # → "1"
resolve_expression("${1e10}", {})             # → "10000000000.0"
```

> **Limitation — no `**` operator**: CEL does not support `**` for
> exponentiation.  There is no built-in `pow()` function in cel-python either.

### String functions

cel-python implements `contains`, `startsWith`, `endsWith`, and `matches`
(regex) from the CEL spec.  The functions `upperAscii`, `lowerAscii`, and
`split` are *not* in the cel-python standard library but are registered as
custom extensions in this prototype:

```python
resolve_expression("${myParam1.upperAscii()}", {"myParam1": "hello"})
# → "HELLO"

resolve_expression("${myParam1.lowerAscii()}", {"myParam1": "WORLD"})
# → "world"

resolve_expression("${myParam1.split('_')[0]}", {"myParam1": "hello_world"})
# → "hello"

resolve_expression("${'needle' in haystack}", {"haystack": "a needle here"})
# → "true"

resolve_expression("${path.startsWith('/etc/')}", {"path": "/etc/hosts"})
# → "true"
```

### Datetime arithmetic

Variables whose values match a datetime pattern (`YYYY-MM-DD`,
`YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DDTHH:MM:SSZ`, etc.) are automatically
coerced to CEL `timestamp` values.  CEL then supports native
`timestamp + duration(...)` arithmetic:

```python
resolve_expression(
    "${submitDatetime + duration('86400s')}",
    {"submitDatetime": "2024-01-15T00:00:00Z"},
)
# → "2024-01-16T00:00:00Z"

resolve_expression(
    "${submitDatetime + duration('3600s')}",
    {"submitDatetime": "2024-01-15T12:00:00Z"},
)
# → "2024-01-15T13:00:00Z"
```

Duration literals use the format `<seconds>s`, `<minutes>m`, `<hours>h`, or
`<days>d` (e.g. `duration('24h')`, `duration('1d')`... though CEL only
guarantees `s`/`m`/`h`/`d` units — cel-python accepts them all).

Timestamps may also be constructed inline:

```python
resolve_expression(
    "${timestamp('2024-01-15T00:00:00Z') + duration('86400s')}",
    {},
)
# → "2024-01-16T00:00:00Z"
```

### Datetime field accessors

CEL timestamps expose accessor methods (all return integers):

```python
resolve_expression("${ts.getFullYear()}", {"ts": "2024-06-15T10:30:00Z"})
# → "2024"

resolve_expression("${ts.getMonth()}", {"ts": "2024-06-15T10:30:00Z"})
# → "5"   (0-based: January = 0)

resolve_expression("${ts.getDayOfMonth()}", {"ts": "2024-06-15T10:30:00Z"})
# → "14"  (0-based)

resolve_expression("${ts.getHours()}", {"ts": "2024-06-15T10:30:00Z"})
# → "10"
```

> **Limitation — no datetime rounding/truncation**: CEL provides no
> `floor_day()` or `floor_hour()` equivalent.  Rounding must be reconstructed
> from individual field accessors, which is verbose and cannot produce a
> `timestamp` result directly.

### Conditional expressions

```python
resolve_expression(
    "${param == 'prod' ? 'production' : 'staging'}",
    {"param": "prod"},
)
# → "production"
```

### Extracting referenced variables

```python
extract_glyphs("${submitDatetime + duration('86400s')} and ${myParam1.upperAscii()}")
# → {"submitDatetime", "myParam1"}

extract_glyphs("${42 * 10}")
# → set()
```

---

## Limitations

| Feature | Status |
|---|---|
| Arithmetic `+` `-` `*` `/` `%` | ✅ Supported natively |
| Exponentiation `**` / `pow()` | ❌ Not supported in CEL |
| `upperAscii()` / `lowerAscii()` | ⚠️ Registered as custom extension |
| `split(sep)` | ⚠️ Registered as custom extension |
| `contains()` / `startsWith()` / `endsWith()` / `matches()` | ✅ Native in cel-python |
| Timestamp + duration arithmetic | ✅ Native CEL |
| Datetime rounding (floor_day, floor_hour) | ❌ Not supported |
| String formatting / strftime | ❌ Not supported |
| `timedelta` / Python datetime | ❌ Not a CEL concept |

### Why `upperAscii` / `split` require extensions

The CEL specification includes `upperAscii`, `lowerAscii`, and `split` in its
string extension library.  However, cel-python (version 0.5.0) does not
implement this extension.  This prototype registers them manually via
`env.program(functions=...)`.  **Any other CEL runtime (Go, Java, C++) would
support these natively** — the extension gap is in cel-python specifically.

### Integer division

CEL's `/` operator performs **integer floor division** when both operands are
integers (matching CEL spec).  Use `double(x) / double(y)` for floating-point
division.

### Type safety

CEL is strictly typed.  Mixing incompatible types (e.g. `int + string`) raises
a `CELEvalError` at runtime.  Variables are auto-coerced: datetime-like strings
become `timestamp`, all other strings remain `string`.

---

## API

```python
def resolve_expression(raw: str, variables: dict[str, str]) -> str:
    """Resolve all ${...} expressions, substituting variables and evaluating CEL."""

def extract_glyphs(raw: str) -> set[str]:
    """Return the set of variable names referenced inside ${...} expressions."""
```

---

## Assessment

CEL is an excellent fit for **safe, portable, deterministic** expression
evaluation.  The portability story is uniquely strong: the same expression works
in Python, Go, Java, C++, and JavaScript environments without modification.

The main practical gaps for this use-case in cel-python are:

1. **String extensions** (`upperAscii`, `lowerAscii`, `split`) are unimplemented
   in cel-python but trivial to shim.
2. **No datetime rounding** — workarounds exist but are verbose.
3. **No `**` operator** — unlikely to matter for most interpolation use-cases.

If the runtime were Go or Java, all of the above limitations disappear.
