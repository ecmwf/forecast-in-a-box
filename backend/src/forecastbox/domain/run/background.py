# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Background execution of a run: compilation, context persistence, and cascade submission.

The task runs on a ``ConcurrentPools.RunSubmission`` worker so the caller can return an
ExecuteResult immediately. It may wait, bounded, for runtime artifacts which are downloaded
on ``ConcurrentPools.ArtifactIo``. Business failures are recorded in the run row.
Jobs-database access is performed synchronously on the worker thread and serialized by
the shared jobs RLock.
"""

import logging
import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from fiab_core.fable import BlockInstanceId

from forecastbox.domain.artifact.base import CompositeArtifactId
from forecastbox.domain.artifact.manager import get_download_status, submit_artifact_download
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

ARTIFACT_WAIT_TIMEOUT_SECONDS = 3600
ARTIFACT_POLL_INTERVAL_SECONDS = 1.0
RUN_STATUS_CHECK_INTERVAL_SECONDS = 10.0


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


def _mark_failed(run_id: RunId, attempt_count: int, current_status: RunStatus, error: str) -> None:
    """Record a failed status with compare-and-swap, reconciling with a concurrent stop or deletion if the write is lost."""
    if not db.update_run_runtime(run_id, attempt_count, expected_status=current_status, status="failed", error=error[:255]):
        # NOTE lost to a concurrent stop or deletion
        _abort_if_not_proceeding(run_id, attempt_count, expected=current_status)


@dataclass(frozen=True, eq=True, slots=True)
class _ArtifactWait:
    aborted: bool = False  # run stopped/deleted meanwhile; caller returns silently
    error: str | None = None  # caller marks the run failed with this message


def _await_runtime_artifacts(run_id: RunId, attempt_count: int, artifacts: Iterable[CompositeArtifactId]) -> _ArtifactWait:
    """Start downloads of missing artifacts and wait, bounded, until all are available.

    Failed downloads are not retried here. Returns early on a failed or vanished artifact, on timeout,
    or when the run was stopped or deleted.
    """
    # NOTE kept here rather than in domain.artifact: the loop is mostly run-lifecycle logic (stop/delete checks against
    # the run row, run-specific failure messages), and the artifact domain already exposes the needed primitives
    # (submit_artifact_download, get_download_status). Moving it would need a callback-heavy generic wait API.
    pending: list[CompositeArtifactId] = []
    for artifact_id in artifacts:
        if get_download_status(artifact_id).state == "available":
            continue
        result = submit_artifact_download(artifact_id, retry=False)
        if result.e:
            return _ArtifactWait(error=f"Failed to submit download for {artifact_id}: {result.e}")
        pending.append(artifact_id)

    start = time.monotonic()
    last_status_check = start
    while pending:
        remaining: list[CompositeArtifactId] = []
        for artifact_id in pending:
            status = get_download_status(artifact_id)
            if status.state == "available":
                continue
            if status.state == "failed":
                return _ArtifactWait(error=f"Runtime artifact {artifact_id} failed to download: {status.error}")
            if status.state == "absent":
                return _ArtifactWait(error=f"Runtime artifact {artifact_id} is no longer available")
            remaining.append(artifact_id)
        pending = remaining
        if not pending:
            break

        now = time.monotonic()
        if now - start > ARTIFACT_WAIT_TIMEOUT_SECONDS:
            return _ArtifactWait(error="Timeout waiting for runtime artifacts to download")
        if now - last_status_check >= RUN_STATUS_CHECK_INTERVAL_SECONDS:
            last_status_check = now
            if _abort_if_not_proceeding(run_id, attempt_count, expected="preparing"):
                return _ArtifactWait(aborted=True)
        time.sleep(ARTIFACT_POLL_INTERVAL_SECONDS)
    logger.info(f"all runtime artifacts available for {run_id=}")
    return _ArtifactWait()


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

    Business failures (compilation error, gateway rejection, failed artifact, timeout) are
    recorded in the run row and are a normal task completion; they are not re-raised. Only an
    exception escaping the failure recording itself reaches the manager's monitoring.
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

        runtime_artifacts = compilation_result.execution_spec.environment.runtime_artifacts
        if runtime_artifacts:
            # NOTE the wait occupies this RunSubmission worker while downloads run on ArtifactIo -- never share the pool
            # TODO move the artifact download to the correct pool and chain with submit_after
            outcome = _await_runtime_artifacts(run_id, attempt_count, runtime_artifacts)
            if outcome.aborted:
                return
            if outcome.error is not None:
                _mark_failed(run_id, attempt_count, current_status, outcome.error)
                return
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
            _mark_failed(run_id, attempt_count, current_status, error)
    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {repr(e)}")
        logger.debug(f"updating background data of {run_id=}")
        _mark_failed(run_id, attempt_count, current_status, repr(e))
