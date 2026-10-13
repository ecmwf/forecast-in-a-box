# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Profiler backends for pluginProf.

Every backend implements the Profiler protocol: ``start()``, ``stop()``, and ``write(out_dir, stem)`` which
writes the result files, named ``<stem>.<suffix>``, and returns their paths. A new backend is added by implementing
the protocol and registering the class in PROFILERS.

Backends:
 - pyinstrument: sampling profiler with low overhead. Produces an interactive html (call tree / timeline), a
   speedscope json (flamegraph, openable at https://www.speedscope.app), a text call tree, and a tsv of functions with
   self and cumulative time. Sampling has no notion of call counts, so the tsv has ``-`` in the calls column.
 - cprofile: deterministic profiler, with significant overhead (several times slowdown on call-heavy code).
   Produces a tsv of functions with call counts, self and cumulative time, a text table, and a binary ``.prof``
   which can be opened with eg snakeviz.

The tsv files have columns: function, file, line, calls, self_ms, self_ms_per_call, cum_ms, cum_ms_per_call,
sorted by cum_ms descending. Percall columns are ``-`` where the calls are not known.
"""

import cProfile
import io
import pstats
from collections import defaultdict
from pathlib import Path
from typing import Protocol

from pyinstrument import Profiler as PyinstrumentProfiler
from pyinstrument.frame import Frame
from pyinstrument.renderers import SpeedscopeRenderer

TSV_HEADER = ["function", "file", "line", "calls", "self_ms", "self_ms_per_call", "cum_ms", "cum_ms_per_call"]

# function, file, line
FunctionKey = tuple[str, str, int]


class Row:
    def __init__(self, calls: int | None, self_s: float, cum_s: float) -> None:
        self.calls = calls
        self.self_s = self_s
        self.cum_s = cum_s


class Profiler(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def write(self, out_dir: Path, stem: str) -> list[Path]: ...


def write_tsv(path: Path, rows: dict[FunctionKey, Row]) -> None:
    lines = ["\t".join(TSV_HEADER)]
    for (function, file, line), row in sorted(rows.items(), key=lambda kv: -kv[1].cum_s):
        calls = str(row.calls) if row.calls is not None else "-"
        self_pc = f"{row.self_s * 1e3 / row.calls:.6f}" if row.calls else "-"
        cum_pc = f"{row.cum_s * 1e3 / row.calls:.6f}" if row.calls else "-"
        lines.append("\t".join([function, file, str(line), calls, f"{row.self_s * 1e3:.3f}", self_pc, f"{row.cum_s * 1e3:.3f}", cum_pc]))
    path.write_text("\n".join(lines) + "\n")


class PyinstrumentBackend:
    def __init__(self) -> None:
        self.profiler = PyinstrumentProfiler(interval=0.001)

    def start(self) -> None:
        self.profiler.start()

    def stop(self) -> None:
        self.profiler.stop()

    def write(self, out_dir: Path, stem: str) -> list[Path]:
        html = out_dir / f"{stem}.html"
        speedscope = out_dir / f"{stem}.speedscope.json"
        text = out_dir / f"{stem}.txt"
        tsv = out_dir / f"{stem}.tsv"
        html.write_text(self.profiler.output_html())
        speedscope.write_text(self.profiler.output(SpeedscopeRenderer()))
        text.write_text(self.profiler.output_text(unicode=False, color=False))
        write_tsv(tsv, self._flat_rows())
        return [html, speedscope, text, tsv]

    def _flat_rows(self) -> dict[FunctionKey, Row]:
        session = self.profiler.last_session
        if session is None:
            raise RuntimeError("the profiler has not collected any session")
        root = session.root_frame()
        rows: dict[FunctionKey, Row] = defaultdict(lambda: Row(None, 0.0, 0.0))

        def visit(frame: Frame, active: frozenset[FunctionKey]) -> None:
            key = (frame.function or "?", frame.file_path or "?", frame.line_no or 0)
            row = rows[key]
            row.self_s += frame.total_self_time
            if key not in active:  # NOTE recursion would otherwise count the cumulative time multiple times
                row.cum_s += frame.time
            for child in frame.children:
                visit(child, active | {key})

        if root is not None:
            visit(root, frozenset())
        return rows


class CProfileBackend:
    def __init__(self) -> None:
        self.profiler = cProfile.Profile()

    def start(self) -> None:
        self.profiler.enable()

    def stop(self) -> None:
        self.profiler.disable()

    def write(self, out_dir: Path, stem: str) -> list[Path]:
        prof = out_dir / f"{stem}.prof"
        text = out_dir / f"{stem}.txt"
        tsv = out_dir / f"{stem}.tsv"
        self.profiler.dump_stats(str(prof))
        buffer = io.StringIO()
        pstats.Stats(self.profiler, stream=buffer).sort_stats("cumulative").print_stats()
        text.write_text(buffer.getvalue())
        stats = pstats.Stats(self.profiler).stats  # ty: ignore[unresolved-attribute]
        rows: dict[FunctionKey, Row] = {}
        for (file, line, function), (_cc, nc, tt, ct, _callers) in stats.items():
            rows[(function, file, line)] = Row(nc, tt, ct)
        write_tsv(tsv, rows)
        return [prof, text, tsv]


PROFILERS: dict[str, type[Profiler]] = {
    "pyinstrument": PyinstrumentBackend,
    "cprofile": CProfileBackend,
}
