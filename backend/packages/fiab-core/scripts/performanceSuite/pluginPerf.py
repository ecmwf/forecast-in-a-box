#!/usr/bin/env python3
#
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Measures the duration of a plugin's import, and of validate/expand/compile of individual blocks.

Usage:
    python -m performanceSuite.pluginPerf <plugin-dir>/tests/perf --module <module_name> --artifacts <artifacts.json> [--label <label>]

Every ``*.json`` file in the given directory is a case, of the form::

    {"blocks": {"<blockInstanceId>": {"factory_id": "...", "instance": {"configuration_values": {...}, "input_ids": {...}}}}}

that is, the ``blocks`` part of a BlueprintTemplate. An optional top-level ``"skipped": "<reason>"`` causes the case
to be skipped, with the reason reported on stderr. Configuration values are given in their serialized
form, and are converted via the factory's ``value_type.validate_convert`` before being passed to the plugin.

Measurement:
 - the plugin module import and the ``plugin()`` invocation are measured once each, after the shared core
   libraries (fiab_core, earthkit.workflows, pydantic, ...) have already been imported
 - for each block of each case, in the order of declaration, the validator, the expander (of the validated
   output, unless NoOutput) and the compiler are invoked once as warmup and then REPEATS times. The warmup
   duration, and the mean and sample variance of the repeats, are reported
 - any failure, be it an exception or an error returned from the plugin, crashes the whole suite

Output is a tsv on stdout, without header, with columns: key, warmup_ms, mean_ms, var_ms2, where key is
``<label>/<case>/<block>/<phase>``, with phase being one of validate, expand, compile, or ``<label>/-/-/import``
and ``<label>/-/-/plugin_init`` for the single-sample measurements (which have ``-`` in warmup and var).

The constraints on the cases are described in the package docstring of performanceSuite. The ``skipped`` flag is honoured.

Additionally, compared to the backend, these are not performed: glyph resolution, duplicate/cycle detection, expansion
by other plugins, possible sources listing, restrictions serialization, graph merging and deduplication, graph2job,
the repeated validation after compilation. The ArtifactsProvider is faked: the artifact lookup is parsed from the
given artifacts.json, with all artifacts considered locally compatible and stored under the store id ``ecmwf``, and
the local path of an artifact is a non-existent path in a temporary directory. The compile is invoked within
the same NodeMetadataContext(builder=...) as in the backend.
"""

# TODO add resulting graph size reporting etc

import argparse
import importlib
import statistics
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from earthkit.workflows.fluent import Action

import fiab_core.tools.blocks  # noqa: F401 # NOTE preloaded so that its import time is not attributed to the plugin
import fiab_core.tools.plugins  # noqa: F401 # NOTE preloaded so that its import time is not attributed to the plugin
from fiab_core.fable import ActionLookup, BlockInstance, BlockInstanceId, BlockInstanceOutput, NoOutput
from fiab_core.plugin import Plugin
from performanceSuite import PerfCase, compile_block, prepare_block, register_fake_artifacts_provider, validate_block

REPEATS = 3

T = TypeVar("T")


class Measurement:
    def __init__(self, warmup_ns: int | None, samples_ns: list[int]) -> None:
        self.warmup_ns = warmup_ns
        self.samples_ns = samples_ns

    def as_columns(self) -> list[str]:
        ms = [s / 1e6 for s in self.samples_ns]
        warmup = f"{self.warmup_ns / 1e6:.3f}" if self.warmup_ns is not None else "-"
        var = f"{statistics.variance(ms):.6f}" if len(ms) > 1 else "-"
        return [warmup, f"{statistics.mean(ms):.3f}", var]


def emit(key: str, measurement: Measurement) -> None:
    print("\t".join([key, *measurement.as_columns()]), flush=True)


def time_once(fn: Callable[[], T]) -> tuple[T, int]:
    start = time.perf_counter_ns()
    result = fn()
    return result, time.perf_counter_ns() - start


def time_repeated(fn: Callable[[], T]) -> tuple[T, Measurement]:
    """Runs fn once as warmup and then REPEATS times, returning the last result and the measurement"""
    result, warmup = time_once(fn)
    samples = []
    for _ in range(REPEATS):
        result, sample = time_once(fn)
        samples.append(sample)
    return result, Measurement(warmup, samples)


def load_plugin(module_name: str, label: str) -> Plugin:
    module, import_ns = time_once(lambda: importlib.import_module(module_name))
    emit(f"{label}/-/-/import", Measurement(None, [import_ns]))
    plugin, init_ns = time_once(lambda: getattr(module, "plugin")())
    if not isinstance(plugin, Plugin):
        raise TypeError(f"{module_name}.plugin() returned {type(plugin)}, expected Plugin")
    emit(f"{label}/-/-/plugin_init", Measurement(None, [init_ns]))
    return plugin


def run_case(plugin: Plugin, case_path: Path, label: str) -> None:
    case = PerfCase.model_validate_json(case_path.read_text())
    case_name = case_path.stem
    if case.skipped is not None:
        print(f"skipping {case_path}: {case.skipped}", file=sys.stderr)
        return
    outputs: dict[BlockInstanceId, BlockInstanceOutput] = {}
    instances: dict[BlockInstanceId, BlockInstance] = {}

    for block_id, block in case.blocks.items():
        context = f"{case_path}:{block_id}"
        instance, inputs = prepare_block(plugin, context, block, outputs)
        instances[block_id] = instance

        output, measurement = time_repeated(lambda: validate_block(plugin, context, block, instance, inputs))
        emit(f"{label}/{case_name}/{block_id}/validate", measurement)
        outputs[block_id] = output

        if not isinstance(output, NoOutput):
            _, measurement = time_repeated(lambda: plugin.expander(output))
            emit(f"{label}/{case_name}/{block_id}/expand", measurement)

    action_lookup: ActionLookup = {}
    for block_id, block in case.blocks.items():
        context = f"{case_path}:{block_id}"
        instance = instances[block_id]

        action, measurement = time_repeated(lambda: compile_block(plugin, context, block_id, block, instance, action_lookup))
        emit(f"{label}/{case_name}/{block_id}/compile", measurement)
        action_lookup[block_id] = action


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("perf_dir", type=Path, help="directory with the perf cases, typically <plugin>/tests/perf")
    parser.add_argument("--module", required=True, help="module name of the plugin, eg fiab_plugin_test")
    parser.add_argument("--artifacts", required=True, type=Path, help="path to the artifacts.json catalog")
    parser.add_argument("--label", default=None, help="prefix of the output keys, defaults to the module name")
    args = parser.parse_args()

    cases = sorted(args.perf_dir.glob("*.json"))
    if not cases:
        raise ValueError(f"no cases found in {args.perf_dir}")
    register_fake_artifacts_provider(args.artifacts)
    label = args.label or args.module

    plugin = load_plugin(args.module, label)
    for case_path in cases:
        run_case(plugin, case_path, label)


if __name__ == "__main__":
    sys.exit(main())
