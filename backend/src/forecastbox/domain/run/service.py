# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for the job execution domain.

Owns:
- compile-and-submit flow (execute),
- restart flow,
- status polling with cascade,
- linked-blueprint lookup,
- output availability / content lookups,
- logs packaging.

No HTTP exceptions are raised here; callers are responsible for mapping domain
exceptions (``RunNotFound``, ``RunAccessDenied``) to HTTP responses.

Authorization is enforced via ``domain.run.db`` which filters / rejects
based on the supplied ``AuthContext``.
"""

import logging
from collections.abc import Callable
from functools import partial
from typing import TypeVar, cast

from cascade.controller.report import JobId
from cascade.gateway import api, client
from cascade.low.core import DatasetId, TaskId
from cascade.low.func import Either
from fiab_core.fable import BlockInstanceId, is_textual
from pydantic import Field

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.run.db as run_db
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.gateway.exceptions import GatewayExited, GatewayNotStarted
from forecastbox.domain.gateway.service import get_current_cascade_proc, get_gateway_url
from forecastbox.domain.run.background import execute_background
from forecastbox.domain.run.cascade import RunOutputCharacteristic, RunOutputs, stored_output_max_length
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.detail import retrieve_compilation_detail
from forecastbox.domain.run.exceptions import CompilationDetailCorrupted, CompilationDetailNotFound, RunNotFound
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.jobs import RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.httpx import get_encoding
from forecastbox.utility.memcache import pop as pop_memcache
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)
T = TypeVar("T")


async def _await_jobs_db(task_name: str, task: Callable[[], T]) -> T:
    return await execution_manager.awaitable_submit(ConcurrentPools.JobsDb, TaskName(task_name), task)


def _jobs_db_result(task_name: str, task: Callable[[], T]) -> T:
    return execution_manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName(task_name), task).result()


def _decode_textual_output(raw: bytes, mime_type: str) -> str:
    """Decode raw bytes to string using the charset declared in the mime_type.

    Falls back to utf-8 when no charset is specified. On decode error, stores a
    diagnostic message instead of raising.
    """
    encoding = get_encoding(mime_type)
    try:
        return raw.decode(encoding)[:stored_output_max_length]
    except Exception as e:
        return f"Decoding Error: {repr(e)}"[:stored_output_max_length]


class RunDetail(FiabBaseModel):
    """Detail of a single job execution attempt."""

    run_id: RunId
    attempt_count: int
    status: RunStatus
    created_at: str
    updated_at: str
    user: str
    blueprint_id: BlueprintId
    blueprint_version: int
    error: str | None = None
    progress: str | None = None
    cascade_job_id: str | None = None
    available_task_ids: list[TaskId] | None = None
    lost_task_ids: dict[TaskId, str] = Field(default_factory=dict)
    outputs: dict | None = None
    completed_block_ids: set[BlockInstanceId] | None = None
    planned_block_ids: set[BlockInstanceId] | None = None


class ExecuteResult(FiabBaseModel):
    """Result of a job execution submission."""

    run_id: RunId
    """Logical execution id (Run.id)."""
    attempt_count: int
    """Attempt number; always 1 on a fresh execution."""


def get_mime_of_output(execution: run_db.RunRecord, dataset_id: DatasetId) -> Either[str, str]:  # ty: ignore[invalid-type-arguments]
    """Return the declared mime type for a run output task."""
    raw_outputs = cast(dict | None, execution.outputs)
    if raw_outputs is None:
        return Either.error(f"Run {execution.run_id!r} has no recorded outputs yet")

    try:
        outputs = RunOutputs.model_validate(raw_outputs)
    except Exception as e:
        return Either.error(f"Run {execution.run_id!r} has invalid output metadata: {e!r}")

    task_id = dataset_id.task
    characteristic = outputs.outputs.get(task_id)
    if characteristic is None:
        return Either.error(f"Output {task_id!r} not found for run {execution.run_id!r}")
    return Either.ok(characteristic.mime_type)


async def get_blueprint_for_execution(blueprint_id: BlueprintId, blueprint_version: int | None) -> blueprint_db.BlueprintRecord | None:
    """Retrieve a Blueprint from the jobs store by id and optional version."""
    return await _await_jobs_db(
        "run.blueprint.get",
        partial(blueprint_db.get_blueprint, blueprint_id, blueprint_version),
    )


def submit_run_sync(
    blueprint: blueprint_db.BlueprintRecord,
    auth_context: AuthContext,
    run_id: RunId | None = None,
    experiment_id: ExperimentDefinitionId | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: CompilerRuntimeContext = CompilerRuntimeContext(),
    experiment_context: str | None = None,
) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
    """Synchronously create a Run row and enqueue background execution."""
    logger.debug(f"starting blueprint execution {blueprint.blueprint_id}")
    if not blueprint.builder:
        return Either.error(f"Blueprint {blueprint.blueprint_id!r} has no compilable blocks")

    blueprint_id = BlueprintId(str(blueprint.blueprint_id))  # ty:ignore[invalid-argument-type]
    blueprint_version = blueprint.version

    new_run_id, attempt_count, created_at = _jobs_db_result(
        "run.upsert",
        partial(
            run_db.upsert_run,
            run_id=run_id,
            blueprint_id=blueprint_id,
            blueprint_version=blueprint_version,
            created_by=auth_context.user_id,
            status="submitted",
            experiment_id=experiment_id,
            experiment_version=experiment_version,
            experiment_context=experiment_context,
        ),
    )

    logger.debug(f"submitting blueprint execution {blueprint.blueprint_id}")
    execution_manager.submit_unmonitored(
        ConcurrentPools.RunSubmission,
        TaskName("run.execute-background"),
        partial(
            execute_background,
            new_run_id,
            attempt_count,
            created_at,
            blueprint,
            compiler_runtime_context,
            auth_context,
        ),
    )

    return Either.ok(ExecuteResult(run_id=new_run_id, attempt_count=attempt_count))


async def execute(
    blueprint: blueprint_db.BlueprintRecord,
    auth_context: AuthContext,
    run_id: RunId | None = None,
    experiment_id: ExperimentDefinitionId | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: CompilerRuntimeContext = CompilerRuntimeContext(),
    experiment_context: str | None = None,
) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
    """Always create a Run linked to the given Blueprint.

    The route-facing async wrapper awaits ``submit_run_sync`` on the General
    pool so it still returns an ``ExecuteResult`` immediately without waiting
    for compilation or cascade submission. When ``run_id`` is supplied the new
    attempt is appended under that existing id; otherwise the database layer
    generates a fresh id. Experiment metadata is stored on the row when
    provided and preserved on restart.
    """
    return await execution_manager.awaitable_submit(
        ConcurrentPools.General,
        TaskName("run.submit"),
        partial(
            submit_run_sync,
            blueprint,
            auth_context,
            run_id=run_id,
            experiment_id=experiment_id,
            experiment_version=experiment_version,
            compiler_runtime_context=compiler_runtime_context,
            experiment_context=experiment_context,
        ),
    )


async def restart_run(run_id: RunId, auth_context: AuthContext) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
    """Create a new attempt under an existing run_id, re-running its linked Blueprint.

    Raises ``RunNotFound`` if the execution does not exist.
    Raises ``RunAccessDenied`` if the actor does not own the execution.
    """
    existing = await _await_jobs_db(
        "run.get",
        partial(run_db.get_run, run_id, auth_context=auth_context),
    )
    # get_run raises RunNotFound / RunAccessDenied on failure.

    blueprint_id = BlueprintId(str(existing.blueprint_id))  # ty:ignore[invalid-argument-type]
    blueprint_version = cast(int, existing.blueprint_version)
    blueprint = await _await_jobs_db(
        "run.blueprint.get",
        partial(blueprint_db.get_blueprint, blueprint_id, blueprint_version),
    )
    if blueprint is None:
        return Either.error(f"Blueprint {blueprint_id!r} v{blueprint_version} not found")

    raw_context = cast(dict, existing.compiler_runtime_context)
    context = CompilerRuntimeContext.model_validate(raw_context)

    return await execute(
        blueprint,
        auth_context,
        run_id=run_id,
        experiment_id=ExperimentDefinitionId(str(existing.experiment_id)) if existing.experiment_id is not None else None,  # ty:ignore[invalid-argument-type]
        experiment_version=cast(int | None, existing.experiment_version),
        compiler_runtime_context=context,
        experiment_context=cast(str | None, existing.experiment_context),
    )


async def poll_and_update(execution: run_db.RunRecord, detailed_report: bool = False) -> RunDetail:
    """Poll cascade for a Run's status, update db if changed, and return current detail."""
    run_id = RunId(str(execution.run_id))  # ty:ignore[invalid-argument-type]
    actual_attempt = execution.attempt_count
    cascade_job_id = execution.cascade_job_id
    status = execution.status

    # Derive available_task_ids from stored outputs without calling cascade for terminal states:
    # completed → assume all outputs are available while the same gateway process is active;
    # failed → only those with a locally cached value.
    raw_outputs = cast(dict | None, execution.outputs)
    stored_cascade_proc = cast(int | str | None, getattr(execution, "cascade_proc", None))
    available_task_ids: list[TaskId] | None
    lost_task_ids: dict[TaskId, str] = {}
    if status == "completed":
        try:
            current_cascade_proc = get_current_cascade_proc()
        except (GatewayExited, GatewayNotStarted):
            current_cascade_proc = None
        if current_cascade_proc is not None and stored_cascade_proc == current_cascade_proc:
            available_task_ids = [TaskId(k) for k in (raw_outputs or {}).get("outputs", {}).keys()]
        elif raw_outputs:
            try:
                cached_outputs = RunOutputs.model_validate(raw_outputs)
                available_task_ids = [tid for tid, char in cached_outputs.outputs.items() if char.value is not None]
                lost_task_ids = {tid: "Gateway Proc changed" for tid, char in cached_outputs.outputs.items() if char.value is None}
            except Exception:
                available_task_ids = []
        else:
            available_task_ids = []
    elif status == "failed":
        if raw_outputs:
            try:
                _cached = RunOutputs.model_validate(raw_outputs)
                available_task_ids = [tid for tid, char in _cached.outputs.items() if char.value is not None]
            except Exception:
                available_task_ids = []
        else:
            available_task_ids = []
    else:
        available_task_ids = None

    def _translate_task_ids(
        task_ids_by_job: dict[JobId, list[TaskId]] | None,
        task_to_block: dict[TaskId, BlockInstanceId] | None,
        job_id: JobId,
    ) -> set[BlockInstanceId] | None:
        if task_ids_by_job is None or task_to_block is None:
            return None
        return {task_to_block[task_id] for task_id in task_ids_by_job[job_id]}

    def _build(
        status_override: RunStatus | None = None,
        error_override: str | None = None,
        progress_override: str | None = None,
        completed_block_ids: set[BlockInstanceId] | None = None,
        planned_block_ids: set[BlockInstanceId] | None = None,
    ) -> RunDetail:
        return RunDetail(
            run_id=run_id,
            attempt_count=actual_attempt,
            status=status_override or status,
            created_at=value_dt2str(execution.created_at),
            updated_at=value_dt2str(execution.updated_at),
            user=execution.created_by,
            blueprint_id=BlueprintId(str(execution.blueprint_id)),  # ty:ignore[invalid-argument-type]
            blueprint_version=execution.blueprint_version,
            error=error_override if error_override is not None else execution.error,
            progress=progress_override if progress_override is not None else execution.progress,
            cascade_job_id=cascade_job_id,
            available_task_ids=available_task_ids,
            lost_task_ids=lost_task_ids,
            outputs=raw_outputs,
            completed_block_ids=completed_block_ids,
            planned_block_ids=planned_block_ids,
        )

    if status in ("submitted", "preparing", "running", "unknown") and cascade_job_id:
        job_id = JobId(cascade_job_id)
        warning_error: str | None = None
        task_to_block: dict[TaskId, BlockInstanceId] | None = None
        if detailed_report:
            try:
                compilation_detail = retrieve_compilation_detail(run_id)
                task_to_block = {task_id: td.block for task_id, td in compilation_detail.task_detail.items()}
            except (CompilationDetailNotFound, CompilationDetailCorrupted) as e:
                detailed_report = False
                warning_error = f"unable to provide completed/planned tasks: {repr(e)}"

        try:
            response = client.request_response(
                api.JobProgressRequest(job_ids=[job_id], detailed_report=detailed_report),
                get_gateway_url(),
            )
            response = cast(api.JobProgressResponse, response)
        except TimeoutError:
            return _build(status_override="unknown", error_override="failed to communicate with gateway")
        except Exception as e:
            return _build(status_override="unknown", error_override=f"internal cascade failure: {repr(e)}")

        if job_id in response.datasets:
            available_task_ids = [x.task for x in response.datasets[job_id]]

        if response.error:
            return _build(status_override="unknown", error_override=response.error)

        # Fetch and store values for newly available textual outputs.
        # We compare what cascade reports as available against what is already stored locally,
        # and fetch any textual (text/plain) outputs that have not been fetched yet.
        updated_outputs: RunOutputs | None = None
        if raw_outputs is not None and job_id in response.datasets:
            try:
                outputs_model = RunOutputs.model_validate(raw_outputs)
                already_fetched = {tid for tid, char in outputs_model.outputs.items() if char.value is not None}
                cascade_available = {d.task for d in response.datasets[job_id]}
                for task_id in cascade_available - already_fetched:
                    char = outputs_model.outputs.get(task_id)
                    if char is None or not is_textual(char.mime_type):
                        continue
                    try:
                        fetch_resp = client.request_response(
                            api.ResultRetrievalRequest(job_id=job_id, dataset_id=DatasetId(task=task_id, output="0")),
                            get_gateway_url(),
                        )
                        fetch_resp = cast(api.ResultRetrievalResponse, fetch_resp)  # type: ignore[attr-defined]
                        if fetch_resp.error:
                            logger.warning("Failed to fetch value for task %r: %s", task_id, fetch_resp.error)
                            continue
                        decoded = api.decoded_result(fetch_resp, job=None)  # type: ignore[attr-defined]
                        if isinstance(decoded, bytes):
                            char.value = _decode_textual_output(decoded, char.mime_type)
                            updated_outputs = outputs_model
                    except Exception as e:
                        logger.warning("Failed to fetch value for task %r: %r", task_id, e)
            except Exception as e:
                logger.warning("Failed to process textual outputs for run %r: %r", run_id, e)
        if updated_outputs is not None:
            raw_outputs = updated_outputs.model_dump()

        # NOTE we should check more carefuly in the None branch -- the job_id may not be part of the response
        # if the job has not started yet -- but we should verify that in the status, etc
        if task_to_block is not None and response.planned_task_ids is not None and job_id in response.planned_task_ids:
            # any block that has a task planned is a planned block
            planned_block_ids = {task_to_block[task_id] for task_id in response.planned_task_ids[job_id]}
        else:
            planned_block_ids = None
        if task_to_block is not None and response.completed_task_ids is not None and job_id in response.completed_task_ids:
            # any block that has all tasks completed is a completed block
            uncompleted_task_to_block = {k: v for k, v in task_to_block.items() if k not in response.completed_task_ids[job_id]}
            completed_block_ids = set(task_to_block.values()) - set(uncompleted_task_to_block.values())
        else:
            completed_block_ids = None
        jobprogress = response.progresses.get(job_id)
        outputs_kwargs = {"outputs": raw_outputs} if updated_outputs is not None else {}
        if jobprogress is None:
            await _await_jobs_db(
                "run.update-runtime",
                partial(run_db.update_run_runtime, run_id, actual_attempt, status="failed", error="evicted from gateway", **outputs_kwargs),
            )
            available_task_ids = [tid for tid, char in updated_outputs.outputs.items() if char.value is not None] if updated_outputs else []
            pop_memcache(run_id)
            return _build(status_override="failed", error_override="evicted from gateway")
        elif jobprogress.failure:
            await _await_jobs_db(
                "run.update-runtime",
                partial(run_db.update_run_runtime, run_id, actual_attempt, status="failed", error=jobprogress.failure, **outputs_kwargs),
            )
            available_task_ids = [tid for tid, char in updated_outputs.outputs.items() if char.value is not None] if updated_outputs else []
            pop_memcache(run_id)
            return _build(status_override="failed", error_override=jobprogress.failure)
        elif jobprogress.completed or jobprogress.pct == "100.00":
            await _await_jobs_db(
                "run.update-runtime",
                partial(run_db.update_run_runtime, run_id, actual_attempt, status="completed", progress="100.00", **outputs_kwargs),
            )
            return _build(status_override="completed", progress_override="100.00")
        else:
            await _await_jobs_db(
                "run.update-runtime",
                partial(run_db.update_run_runtime, run_id, actual_attempt, status="running", progress=jobprogress.pct, **outputs_kwargs),
            )
            return _build(
                status_override="running",
                error_override=warning_error,
                progress_override=jobprogress.pct,
                completed_block_ids=completed_block_ids,
                planned_block_ids=planned_block_ids,
            )

    return _build()
