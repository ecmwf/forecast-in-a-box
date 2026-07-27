# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Background execution of a run: compilation, context persistence, and cascade submission.

Runs on a worker thread so the caller can return an ExecuteResult immediately
without waiting for potentially slow cascade submission. Jobs-database access is
performed synchronously on the worker thread and serialized by the shared jobs RLock.
"""

import logging
from datetime import datetime
from typing import cast

from fiab_core.fable import BlockInstanceId

from forecastbox.domain.blueprint.db import BlueprintRecord
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
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.detail import store_compilation_detail
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.memcache import TooLargeEntry
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


def execute_background(
    run_id: RunId,
    attempt_count: int,
    submit_time: datetime,
    blueprint: BlueprintRecord,
    compiler_runtime_context: CompilerRuntimeContext,
    auth_context: AuthContext,
) -> None:
    """Compile a blueprint and submit it to cascade, updating the Run row as we go."""
    logger.debug(f"starting background compilation of {run_id=}")

    try:
        start_time = current_time("glyph_resolution")
        intrinsic_values: dict[str, str] = cast(
            dict[str, str],
            resolve_intrinsic_glyph_values(run_id, submit_time, start_time, attempt_count),
        )

        global_buckets: GlyphResolutionBuckets = global_db.get_glyphs_for_resolution(auth_context)

        builder = BlueprintBuilder.model_validate(blueprint.builder)
        local_values: dict[str, str] = builder.local_glyphs

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
        db.update_run_runtime(
            run_id,
            attempt_count,
            compiler_runtime_context=persisted_context.model_dump(exclude_unset=True),
            status="preparing",
        )

        logger.debug(f"starting background submission of {run_id=}")
        response = execute_cascade(exec_spec)
        if response.job_id is not None:
            try:
                store_compilation_detail(
                    run_id,
                    compilation_detail,
                )
            except TooLargeEntry as e:
                logger.warning(f"failed to cache compilation detail for {run_id=}, {attempt_count=}: {repr(e)}")
            db.update_run_runtime(
                run_id,
                attempt_count,
                cascade_job_id=response.job_id,
                cascade_proc=get_current_cascade_proc(),
                outputs=run_outputs.model_dump(),
            )
        else:
            error = (response.error or "no error provided by cascade")[:255]
            db.update_run_runtime(run_id, attempt_count, status="failed", error=error)
    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {repr(e)}")
        logger.debug(f"updating background data of {run_id=}")
        db.update_run_runtime(run_id, attempt_count, status="failed", error=repr(e)[:255])
