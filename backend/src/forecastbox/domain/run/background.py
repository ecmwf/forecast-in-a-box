# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Background execution of a run: compilation, context persistence, and cascade submission.

Runs in the run-submission pool so the caller can return an
``ExecuteResult`` immediately without waiting for compilation or cascade
submission. Jobs-database reads and writes are submitted as synchronous tasks
to ``ConcurrentPools.JobsDb`` and waited on from this worker.
"""

import logging
from collections.abc import Callable
from datetime import datetime
from functools import partial
from typing import TypeVar, cast

from fiab_core.fable import BlockInstanceId

import forecastbox.domain.blueprint.db as blueprint_db
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.gateway.service import get_current_cascade_proc
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
from forecastbox.domain.run.cascade import execute_cascade
from forecastbox.domain.run.compile import compile_builder, resolve_intrinsic_glyph_values
from forecastbox.domain.run.detail import store_compilation_detail
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import SubmissionRejected, TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.memcache import TooLargeEntry
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)
T = TypeVar("T")


def _jobs_db_result(task_name: str, task: Callable[[], T]) -> T:
    return execution_manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName(task_name), task).result()


def execute_background(
    run_id: RunId,
    attempt_count: int,
    submit_time: datetime,
    blueprint: blueprint_db.BlueprintRecord,
    compiler_runtime_context: db.CompilerRuntimeContext,
    auth_context: AuthContext,
) -> None:
    """Compile a blueprint and submit it to cascade, updating the Run row as we go.

    ``submit_time`` is the ``created_at`` timestamp recorded when the Run row
    was first inserted; it becomes ``submitDatetime`` in the intrinsic glyphs
    so retries preserve the original submission time. ``startDatetime`` is the
    moment this worker actually begins executing.
    """
    logger.debug(f"starting background compilation of {run_id=}")

    try:
        start_time = current_time("glyph_resolution")
        intrinsic_values: dict[str, str] = cast(
            dict[str, str],
            resolve_intrinsic_glyph_values(run_id, submit_time, start_time, attempt_count),
        )

        global_buckets = cast(
            GlyphResolutionBuckets,
            _jobs_db_result(
                "run.background.get-glyphs",
                partial(global_db.get_glyphs_for_resolution, auth_context),
            ),
        )

        builder = BlueprintBuilder.model_validate(getattr(blueprint, "builder"))
        local_values: dict[str, str] = builder.local_glyphs

        # Persist only the glyphs actually referenced in the builder, keeping
        # the stored context lean. Expand from the referenced roots to capture
        # the full transitive dependency closure, then persist the raw
        # pre-expansion values for those glyphs. Intrinsics are excluded
        # because they are always recomputed. This lets a restart re-expand a
        # composite glyph such as "${root}/${runId}" even if the intermediate
        # dependency later disappears from the global DB.
        referenced_glyph_names = {
            name for block in builder.blocks for name in cast(ExtractedGlyphs, extract_glyphs(block.instance).t).glyphs
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

        exec_spec, run_outputs, compilation_detail = compile_builder(builder, relevant_glyphs_and_values)

        persisted_context = compiler_runtime_context.model_copy(update={"glyphs": used_glyphs})
        _jobs_db_result(
            "run.background.update-runtime",
            partial(
                db.update_run_runtime,
                run_id,
                attempt_count,
                compiler_runtime_context=persisted_context.model_dump(exclude_unset=True),
                status="preparing",
            ),
        )

        logger.debug(f"starting background submission of {run_id=}")
        response = execute_cascade(exec_spec)
        if response.job_id is not None:
            try:
                store_compilation_detail(run_id, compilation_detail)
            except TooLargeEntry as e:
                logger.warning(f"failed to cache compilation detail for {run_id=}, {attempt_count=}: {repr(e)}")
            _jobs_db_result(
                "run.background.update-runtime",
                partial(
                    db.update_run_runtime,
                    run_id,
                    attempt_count,
                    cascade_job_id=response.job_id,
                    cascade_proc=get_current_cascade_proc(),
                    outputs=run_outputs.model_dump(),
                ),
            )
        else:
            error = (response.error or "no error provided by cascade")[:255]
            _jobs_db_result(
                "run.background.update-runtime",
                partial(db.update_run_runtime, run_id, attempt_count, status="failed", error=error),
            )
    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {repr(e)}")
        try:
            _jobs_db_result(
                "run.background.update-runtime",
                partial(db.update_run_runtime, run_id, attempt_count, status="failed", error=repr(e)[:255]),
            )
        except SubmissionRejected as update_error:
            logger.error(
                "failed to queue failure update for run %r attempt %d after %r: %r",
                run_id,
                attempt_count,
                e,
                update_error,
            )
        except Exception as update_error:
            logger.exception(
                "failed to persist failure update for run %r attempt %d after %r: %r",
                run_id,
                attempt_count,
                e,
                update_error,
            )
