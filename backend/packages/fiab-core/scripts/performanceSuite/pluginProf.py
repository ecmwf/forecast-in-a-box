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

"""Profiles a single phase of a single block of a single perf case of a plugin.

Usage:
    python -m performanceSuite.pluginProf <plugin>/<case>/<block>/<phase> --packages-dir <dir> --artifacts <artifacts.json>
        [--profiler pyinstrument|cprofile] [--out-dir <dir>] [--warmup]

where <plugin> is the distribution name, eg ``fiab-plugin-test``, found as ``<packages-dir>/<plugin>``, <case> is the
name of a json file in ``<plugin>/tests/perf`` (the ``.json`` suffix is optional), <block> is the block instance id
within the case, and <phase> is one of validate, expand, compile. The cases are in the format of pluginPerf,
except that the ``skipped`` flag is ignored. The plugin must be importable in the current environment.

Procedure: the plugin is imported, and all blocks preceding the selected one are validated (and for the compile
phase, also compiled), without profiling. The selected block's earlier phases are executed as needed -- ie for expand,
the block is validated first. Then the profiler is switched on, the selected phase is executed once, and the
profiler is switched off. With --warmup, the phase is additionally executed once before, unprofiled, so that
one-off costs (lazy imports, caches) are excluded. Failures crash the tool.

The results are written to the out dir, as ``<plugin>.<case>.<block>.<phase>.<profiler>.<suffix>`` files, whose paths
are printed on stdout. The backends and their outputs are described in performanceSuite.profilers.
"""

import argparse
import importlib
import sys
from pathlib import Path
from typing import NamedTuple

from fiab_core.fable import ActionLookup, BlockInstance, BlockInstanceId, BlockInstanceOutput, NoOutput
from fiab_core.plugin import Plugin
from performanceSuite import PHASES, PerfCase, compile_block, prepare_block, register_fake_artifacts_provider, validate_block
from performanceSuite.profilers import PROFILERS


class Target(NamedTuple):
    plugin: str
    case: str
    block: str
    phase: str


def parse_target(raw: str) -> Target:
    parts = raw.split("/")
    if len(parts) != 4:
        raise ValueError(f"target must be <plugin>/<case>/<block>/<phase>, got {raw!r}")
    plugin, case, block, phase = parts
    case = case.removesuffix(".json")
    if phase not in PHASES:
        raise ValueError(f"phase must be one of {PHASES}, got {phase!r}")
    return Target(plugin, case, block, phase)


def load_plugin(module_name: str) -> Plugin:
    module = importlib.import_module(module_name)
    plugin = getattr(module, "plugin")()
    if not isinstance(plugin, Plugin):
        raise TypeError(f"{module_name}.plugin() returned {type(plugin)}, expected Plugin")
    return plugin


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="<plugin>/<case>/<block>/<phase>")
    parser.add_argument("--packages-dir", required=True, type=Path, help="directory containing the plugin distributions")
    parser.add_argument("--artifacts", required=True, type=Path, help="path to the artifacts.json catalog")
    parser.add_argument("--profiler", choices=sorted(PROFILERS), default="pyinstrument")
    parser.add_argument("--out-dir", type=Path, default=Path("profiles"))
    parser.add_argument("--warmup", action="store_true", help="execute the selected phase once more, unprofiled, before profiling")
    args = parser.parse_args()

    target = parse_target(args.target)
    case_path = args.packages_dir / target.plugin / "tests" / "perf" / f"{target.case}.json"
    case = PerfCase.model_validate_json(case_path.read_text())  # NOTE the skipped flag is ignored on purpose
    if target.block not in case.blocks:
        raise ValueError(f"block {target.block!r} not in {case_path}, available: {list(case.blocks)}")

    register_fake_artifacts_provider(args.artifacts)
    plugin = load_plugin(target.plugin.replace("-", "_"))
    backend = PROFILERS[args.profiler]()

    outputs: dict[BlockInstanceId, BlockInstanceOutput] = {}
    instances: dict[BlockInstanceId, BlockInstance] = {}
    action_lookup: ActionLookup = {}

    def contextOf(block_id: BlockInstanceId) -> str:
        return f"{case_path}:{block_id}"

    def run_selected(profile: bool) -> None:
        """Executes the selected phase, with the profiler on if requested"""
        block_id = BlockInstanceId(target.block)
        block = case.blocks[block_id]
        instance = instances[block_id]
        if target.phase == "validate":
            inputs = {name: outputs[source] for name, source in instance.input_ids.items()}

            def action() -> None:
                validate_block(plugin, contextOf(block_id), block, instance, inputs)
        elif target.phase == "expand":
            output = outputs[block_id]
            if isinstance(output, NoOutput):
                raise ValueError(f"{contextOf(block_id)}: block has NoOutput, nothing to expand")

            def action() -> None:
                plugin.expander(output)
        else:

            def action() -> None:
                compile_block(plugin, contextOf(block_id), block_id, block, instance, action_lookup)

        if profile:
            backend.start()
            try:
                action()
            finally:
                backend.stop()
        else:
            action()

    # preceding blocks, and the validation of the selected one unless it is itself profiled, unprofiled
    for block_id, block in case.blocks.items():
        instance, inputs = prepare_block(plugin, contextOf(block_id), block, outputs)
        instances[block_id] = instance
        if block_id == target.block and target.phase == "validate":
            break
        outputs[block_id] = validate_block(plugin, contextOf(block_id), block, instance, inputs)
        if block_id == target.block:
            break
    if target.phase == "compile":
        for block_id, block in case.blocks.items():
            if block_id == target.block:
                break
            action_lookup[block_id] = compile_block(plugin, contextOf(block_id), block_id, block, instances[block_id], action_lookup)

    if args.warmup:
        run_selected(profile=False)
    run_selected(profile=True)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{target.plugin}.{target.case}.{target.block}.{target.phase}.{args.profiler}"
    for path in backend.write(args.out_dir, stem):
        print(path)


if __name__ == "__main__":
    sys.exit(main())
