# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Background execution of a run: compilation, context persistence, and cascade submission.

Runs in a thread-pool executor (not the async event loop) so that the caller can return
an ExecuteResult immediately without waiting for potentially slow cascade submission.
Async database calls are dispatched back to the event loop via
``asyncio.run_coroutine_threadsafe``.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import cast

from fiab_core.fable import BlockInstanceId

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.glyphs import global_db
from forecastbox.domain.glyphs.global_db import GlyphResolutionBuckets
from forecastbox.domain.glyphs.resolution import (
    PINNED_INTRINSIC_KEYS,
    ExtractedGlyphs,
    expand_glyph_values,
    extract_glyphs,
    merge_glyph_values,
)
from forecastbox.domain.run import db
from forecastbox.domain.run.cascade import ExecutionSpecification, RunOutputCharacteristic, RunOutputs, execute_cascade
from forecastbox.domain.run.compile import compile_builder, resolve_intrinsic_glyph_values
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.jobs import Blueprint
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


def execute_background(
    run_id: RunId,
    attempt_count: int,
    submit_time: datetime,
    blueprint: Blueprint,
    compiler_runtime_context: CompilerRuntimeContext,
    loop: asyncio.AbstractEventLoop,
    auth_context: AuthContext,
) -> None:
    """Compile a blueprint and submit it to cascade, updating the Run row as we go.

    Intended to run in a thread-pool executor. All async database mutations are
    dispatched to ``loop`` via ``asyncio.run_coroutine_threadsafe``.

    ``submit_time`` is the ``created_at`` timestamp recorded when the Run row was
    first inserted; it becomes ``submitDatetime`` in the intrinsic glyphs so that
    retries preserve the original submission time. ``startDatetime`` is set to the
    moment this function actually begins executing (i.e. ``current_time()``).
    """

    def run_async(coro: object) -> object:  # type: ignore[type-arg]
        return asyncio.run_coroutine_threadsafe(coro, loop).result()  # type: ignore[arg-type]

    try:
        start_time = current_time()
        intrinsic_values: dict[str, str] = cast(
            dict[str, str],
            resolve_intrinsic_glyph_values(run_id, submit_time, start_time, attempt_count),
        )

        global_buckets = cast(GlyphResolutionBuckets, run_async(global_db.get_glyphs_for_resolution(auth_context)))

        builder = BlueprintBuilder.model_validate(blueprint.builder)
        local_values: dict[str, str] = builder.local_glyphs

        # Persist only the glyphs actually referenced in the builder, keeping the stored context lean.
        # Use expand_glyph_values with roots to get the full transitive closure of dependencies,
        # then persist raw (pre-expansion) values for all of them (excluding intrinsics, which are
        # always freshly computed). This ensures composite glyphs like "${root}/${runId}" can
        # re-expand correctly on restart even if the intermediate dependency (e.g. "root") is no
        # longer in the global DB.
        referenced_glyph_names = {
            name for block in builder.blocks.values() for name in cast(ExtractedGlyphs, extract_glyphs(block).t).glyphs
        }
        all_glyphs_raw = merge_glyph_values(
            intrinsic_values,
            global_buckets.public_overriddable,
            global_buckets.user_own,
            global_buckets.public_nonoverridable,
            local_values,
            compiler_runtime_context.glyphs,
        )
        relevant_glyphs_and_values = expand_glyph_values(all_glyphs_raw, roots=referenced_glyph_names)
        used_glyphs = {k: all_glyphs_raw[k] for k in relevant_glyphs_and_values.keys() if k not in PINNED_INTRINSIC_KEYS}

        exec_spec = compile_builder(builder, relevant_glyphs_and_values)

        persisted_context = compiler_runtime_context.model_copy(update={"glyphs": used_glyphs})
        run_async(
            db.update_run_runtime(
                run_id,
                attempt_count,
                compiler_runtime_context=persisted_context.model_dump(exclude_unset=True),
                status="preparing",
            )
        )

        response = execute_cascade(exec_spec)
        cascade_job_id = response.job_id or str(uuid.uuid4())

        update_kwargs: dict[str, object] = {"cascade_job_id": cascade_job_id}
        if response.error:
            update_kwargs["status"] = "failed"
            update_kwargs["error"] = response.error[:255]
        else:
            # ext_outputs was set as a side effect of execute_cascade
            ext_outputs = exec_spec.job.job_instance.ext_outputs or []
            # TODO -- to be changed later: populate mime_type and original_block from compiled builder
            run_outputs = RunOutputs(
                outputs={
                    ds.task: RunOutputCharacteristic(
                        mime_type="application/octet-stream",
                        original_block=BlockInstanceId("unavailable"),  # type: ignore[invalid-argument-type]
                    )
                    for ds in ext_outputs
                }
            )
            update_kwargs["outputs"] = run_outputs.model_dump()
        run_async(db.update_run_runtime(run_id, attempt_count, **update_kwargs))

    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {e}")
        run_async(db.update_run_runtime(run_id, attempt_count, status="failed", error=repr(e)[:255]))
