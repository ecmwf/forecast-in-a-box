"""Microbenchmark for the four interpolation-language prototypes.

Usage:
    python main.py <impl>

where <impl> is one of: jinja2, simpleeval, lark, cel

Each iteration performs one extract_glyphs + one resolve_expression call on the
implementation-specific expression string below.  Three warmup iterations precede
1 000 timed iterations; mean, std, min, and max are reported in milliseconds.

Imports are deferred inside each factory function so that loading one prototype's
dependencies cannot affect the runtime environment of another.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path
from types import ModuleType
from typing import Callable

_PROTO_DIR = Path(__file__).parent.parent

WARMUP = 3
ITERATIONS = 1_000


# ---------------------------------------------------------------------------
# Module loader (shared helper, no prototype-specific imports)
# ---------------------------------------------------------------------------


def _load(label: str, proto_dir_name: str) -> ModuleType:
    path = _PROTO_DIR / proto_dir_name / "interpolation.py"
    spec = importlib.util.spec_from_file_location(f"_bench_{label}", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"_bench_{label}"] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ---------------------------------------------------------------------------
# Per-implementation factory functions
# ---------------------------------------------------------------------------

# Each factory:
#   1. Imports (via _load) exactly the one prototype it owns.
#   2. Defines the expression string appropriate for that prototype's syntax.
#   3. Returns (raw_expr, run_fn) where run_fn() performs one full cycle.


def _make_jinja2() -> tuple[str, Callable[[], None]]:
    mod = _load("jinja2", "jinja2_proto")

    # Pipe-style filters: floor_day, add_days(n), split(sep), first, lower
    raw = (
        "${submitDatetime | floor_day | add_days(3)}"
        ";${42 * 1e3 + 7}"
        ";${myString | split('_') | first | lower}"
    )
    variables = {"submitDatetime": "2024-01-15 06:00:00", "myString": "Foo_Bar_Baz"}

    def _run() -> None:
        mod.extract_glyphs(raw)
        mod.resolve_expression(raw, variables)

    return raw, _run


def _make_simpleeval() -> tuple[str, Callable[[], None]]:
    mod = _load("simpleeval", "simpleeval_proto")

    # Pythonic expressions; method calls on str values work via EvalWithCompoundTypes
    raw = (
        "${floor_day(submitDatetime) + timedelta(days=3)}"
        ";${42 * 1e3 + 7}"
        ";${myString.split('_')[0].lower()}"
    )
    variables = {"submitDatetime": "2024-01-15 06:00:00", "myString": "Foo_Bar_Baz"}

    def _run() -> None:
        mod.extract_glyphs(raw)
        mod.resolve_expression(raw, variables)

    return raw, _run


def _make_lark() -> tuple[str, Callable[[], None]]:
    mod = _load("lark", "lark_proto")

    # Same Pythonic style; method_call + subscript are first-class grammar rules
    raw = (
        "${floor_day(submitDatetime) + timedelta(days=3)}"
        ";${42 * 1e3 + 7}"
        ";${myString.split('_', 1)[0].lower()}"
    )
    variables = {"submitDatetime": "2024-01-15 06:00:00", "myString": "Foo_Bar_Baz"}

    def _run() -> None:
        mod.extract_glyphs(raw)
        mod.resolve_expression(raw, variables)

    return raw, _run


def _make_cel() -> tuple[str, Callable[[], None]]:
    mod = _load("cel", "cel_proto")

    # CEL native syntax: duration() for timedelta, lowerAscii() for lowercase
    # Note: ** (exponentiation) is not supported in CEL.
    raw = (
        '${submitDatetime + duration("259200s")}'
        ";${42.0 * 1000.0 + 7.0}"
        ';${myString.split("_")[0].lowerAscii()}'
    )
    variables = {"submitDatetime": "2024-01-15 06:00:00", "myString": "Foo_Bar_Baz"}

    def _run() -> None:
        mod.extract_glyphs(raw)
        mod.resolve_expression(raw, variables)

    return raw, _run


_FACTORIES: dict[str, Callable[[], tuple[str, Callable[[], None]]]] = {
    "jinja2": _make_jinja2,
    "simpleeval": _make_simpleeval,
    "lark": _make_lark,
    "cel": _make_cel,
}


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------


def _benchmark(run: Callable[[], None]) -> list[float]:
    import time

    for _ in range(WARMUP):
        run()

    times: list[float] = []
    for _ in range(ITERATIONS):
        t0 = time.perf_counter()
        run()
        times.append(time.perf_counter() - t0)
    return times


def _stats(times_s: list[float]) -> None:
    ms = [t * 1_000 for t in times_s]
    mean = sum(ms) / len(ms)
    variance = sum((x - mean) ** 2 for x in ms) / len(ms)
    std = math.sqrt(variance)
    print(f"  mean = {mean:.4f} ms")
    print(f"  std  = {std:.4f} ms")
    print(f"  min  = {min(ms):.4f} ms")
    print(f"  max  = {max(ms):.4f} ms")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in _FACTORIES:
        print("Usage: python main.py <impl>")
        print(f"  <impl> one of: {', '.join(_FACTORIES)}")
        sys.exit(1)

    impl = sys.argv[1]
    print(f"Loading {impl} ...", flush=True)
    raw, run = _FACTORIES[impl]()
    print(f"Expression : {raw}")
    print(f"Warmup     : {WARMUP} iterations")
    print(f"Benchmark  : {ITERATIONS} iterations", flush=True)

    times = _benchmark(run)

    print(f"\nResults ({ITERATIONS} iterations):")
    _stats(times)


if __name__ == "__main__":
    main()
