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
from forecastbox.domain.run.stop import stop_cascade_and_mark, stop_cascade_job
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.run import RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.memcache import TooLargeEntry
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


def _abort_if_not_proceeding(run_id: RunId, attempt_count: int, expected: str) -> bool:
    """Return whether the submission must not proceed, because the Run is gone or its status is not ``expected``.

    A Run found ``stopping`` (a stop arrived before there was any cascade job to stop) is moved to ``stopped``.
    """
    record = db.get_run_unchecked(run_id, attempt_count)
    if record is None:
        logger.debug(f"run no longer exists, aborting submission: {run_id=}, {attempt_count=}")
        return True
    if record.status == "stopping":
        logger.debug(f"run stopped before submission, aborting: {run_id=}, {attempt_count=}")
        db.update_run_runtime(run_id, attempt_count, expected_status="stopping", status="stopped")
        return True
    return record.status != expected


def execute_background(
    run_id: RunId,
    attempt_count: int,
    submit_time: datetime,
    blueprint: BlueprintRecord,
    compiler_runtime_context: CompilerRuntimeContext,
    auth_context: AuthContext,
) -> None:
    """Compile a blueprint and submit it to cascade, updating the Run row as we go.

    Intended to run on a worker thread. ``submit_time`` is the ``created_at`` timestamp
    recorded when the Run row was first inserted; it becomes ``submitDatetime`` in the
    intrinsic glyphs so that retries preserve the original submission time.
    ``startDatetime`` is set to the moment this function actually begins executing
    (i.e. ``current_time()``).
    """
    logger.debug(f"starting background compilation of {run_id=}")

    # NOTE every status write is a compare-and-swap against this, which tracks what we last wrote ourselves
    current_status: RunStatus = "submitted"
    try:
        start_time = current_time("glyph_resolution")
        intrinsic_values: dict[str, str] = cast(
            dict[str, str],
            resolve_intrinsic_glyph_values(run_id, submit_time, start_time, attempt_count),
        )

        global_buckets: GlyphResolutionBuckets = global_db.get_glyphs_for_resolution(auth_context)

        builder = BlueprintBuilder.model_validate(blueprint.builder)
        local_values: dict[str, str] = builder.local_glyphs

        # Persist only the glyphs actually referenced in the builder, keeping the stored context lean.
        # Use expand_glyph_values with roots to get the full transitive closure of dependencies,
        # then persist raw (pre-expansion) values for all of them (excluding intrinsics, which are
        # always freshly computed). This ensures composite glyphs like "${root}/${runId}" can
        # re-expand correctly on restart even if the intermediate dependency (e.g. "root") is no
        # longer in the global DB.
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

        compilation_result = compile_builder(builder, relevant_glyphs_and_values)

        persisted_context = compiler_runtime_context.model_copy(
            update={"glyphs": used_glyphs, "resolution": compilation_result.resolved_configuration_options}
        )
        if not db.update_run_runtime(
            run_id,
            attempt_count,
            expected_status=current_status,
            compiler_runtime_context=persisted_context.model_dump(exclude_unset=True),
            status="preparing",
        ):
            # NOTE lost to a concurrent stop or deletion
            _abort_if_not_proceeding(run_id, attempt_count, expected="preparing")
            return
        current_status = "preparing"

        if _abort_if_not_proceeding(run_id, attempt_count, expected="preparing"):
            return

        logger.debug(f"starting background submission of {run_id=}")
        response = execute_cascade(compilation_result.execution_spec)
        if response.job_id is not None:
            try:
                store_compilation_detail(
                    run_id,
                    compilation_result.compilation_detail,
                )
            except TooLargeEntry as e:
                logger.warning(f"failed to cache compilation detail for {run_id=}, {attempt_count=}: {repr(e)}")
            db.update_run_runtime(
                run_id,
                attempt_count,
                cascade_job_id=response.job_id,
                cascade_proc=get_current_cascade_proc(),
                outputs=compilation_result.run_outputs.model_dump(),
            )
            get_id = lambda: f"{run_id=}, {attempt_count=}, {auth_context=}, cascade_job_id={response.job_id}"
            job_id = cast(str, response.job_id)  # NOTE cast due to ty being confused

            # NOTE the stop endpoint cannot issue a cascade call before the cascade_job_id is persisted, so we check
            # for the stopping status here, after the persist, and do the stop on our own. Similarly for the deletion.
            record = db.get_run_unchecked(run_id, attempt_count)
            if record is None:
                logger.warning(f"run vanished after submission by itself: {get_id()}. Issuing cascade stop.")
                try:
                    stop_cascade_job(job_id)
                except Exception as e:
                    logger.warning(f"cascade stop of {get_id()} failed with {e!r}. Ignoring.")
            elif record.status == "stopping":
                logger.debug(f"stopping cascade job right after submission due to stop requested: {get_id()}.")
                stop_cascade_and_mark(run_id, attempt_count, job_id)
        else:
            error = (response.error or "no error provided by cascade")[:255]
            if not db.update_run_runtime(run_id, attempt_count, expected_status=current_status, status="failed", error=error):
                _abort_if_not_proceeding(run_id, attempt_count, expected=current_status)
    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {repr(e)}")
        logger.debug(f"updating background data of {run_id=}")
        if not db.update_run_runtime(run_id, attempt_count, expected_status=current_status, status="failed", error=repr(e)[:255]):
            # NOTE lost to a concurrent stop, which has no cascade job to act on
            _abort_if_not_proceeding(run_id, attempt_count, expected=current_status)
