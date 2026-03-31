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
- linked-definition lookup,
- output availability / content lookups,
- logs packaging.

No HTTP exceptions are raised here; callers are responsible for mapping domain
exceptions (``JobExecutionNotFound``, ``JobExecutionAccessDenied``) to HTTP responses.

Authorization is enforced via ``domain.job_execution.db`` which filters / rejects
based on the supplied ``AuthContext``.
"""

import asyncio
import logging
import time
import uuid
from typing import Any, Sequence, cast

import cascade.gateway.api as api
import cascade.gateway.client as client
from cascade.low import views as cascade_views
from cascade.low.core import JobInstanceRich
from cascade.low.func import Either
from earthkit.workflows.compilers import graph2job
from earthkit.workflows.graph import Graph, deduplicate_nodes
from pydantic import BaseModel

import forecastbox.domain.job_definition.db as job_definition_db
import forecastbox.domain.job_execution.db as job_execution_db
from forecastbox.api.artifacts.manager import ArtifactManager, submit_artifact_download
from forecastbox.api.types.fable import FableBuilder
from forecastbox.api.types.jobs import (
    EnvironmentSpecification,
    ExecutionSpecification,
    JobExecuteResponse,
    JobExecutionDetail,
    JobSpecification,
    RawCascadeJob,
)
from forecastbox.domain.job_definition.service import compile_builder
from forecastbox.domain.job_execution.exceptions import JobExecutionNotFound
from forecastbox.ecpyutil import deep_union
from forecastbox.schemas.jobs import JobDefinition, JobExecution
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)


class ProductToOutputId(BaseModel):
    product_name: str
    product_spec: dict[str, Any]
    output_ids: Sequence[str]


def _execute_cascade(spec: ExecutionSpecification) -> tuple[api.SubmitJobResponse, list[ProductToOutputId]]:
    """Convert spec to JobInstance and submit to cascade api, returning response."""
    runtime_artifacts = spec.environment.runtime_artifacts
    if runtime_artifacts:
        missing_artifacts = [art for art in runtime_artifacts if art not in ArtifactManager.locally_available]

        download_ids = []
        for artifact_id in missing_artifacts:
            result = submit_artifact_download(artifact_id)
            if result.e:
                error_msg = f"Failed to submit download for {artifact_id}: {result.e}"
                logger.error(error_msg)
                return api.SubmitJobResponse(job_id=None, error=error_msg), []
            download_ids.append(artifact_id)

        if download_ids:
            max_wait_seconds = 3600
            start_time = time.time()

            while True:
                remaining = set(download_ids) - ArtifactManager.locally_available

                if not remaining:
                    logger.info(f"All runtime artifacts downloaded: {download_ids}")
                    break

                if time.time() - start_time > max_wait_seconds:
                    error_msg = "Timeout waiting for runtime artifacts to download"
                    logger.error(error_msg)
                    return api.SubmitJobResponse(job_id=None, error=error_msg), []

                time.sleep(1)

    job = spec.job.job_instance
    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]
    job.ext_outputs = sinks
    product_to_id_mappings = [ProductToOutputId(product_name="All Outputs", product_spec={}, output_ids=[x.task for x in sinks])]

    environment = spec.environment
    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.default_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.default_workers_per_host)
    env_vars = {"TMPDIR": config.cascade.venv_temp_dir}

    r = api.SubmitJobRequest(
        job=api.JobSpec(
            workers_per_host=workers_per_host,
            hosts=hosts,
            envvars=env_vars,
            use_slurm=False,
            job_instance=JobInstanceRich(jobInstance=job, checkpointSpec=None),
        )
    )
    try:
        submit_job_response: api.SubmitJobResponse = client.request_response(r, f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=repr(e)), []

    return submit_job_response, product_to_id_mappings


async def get_job_definition_for_execution(definition_id: str, definition_version: int | None) -> JobDefinition | None:
    """Retrieve a JobDefinition from the jobs store by id and optional version."""
    return await job_definition_db.get_job_definition(definition_id, definition_version)


async def execute(
    definition: JobDefinition,
    auth_context: AuthContext,
    execution_id: str | None = None,
    experiment_id: str | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: dict | None = None,
    experiment_context: str | None = None,
) -> Either[JobExecuteResponse, str]:  # type: ignore[invalid-argument]
    """Always creates a JobExecution linked to the given JobDefinition.

    Compiles the definition's blocks via the fable compiler, applies
    compiler_runtime_context (if given) via deep_union to override compiled values
    (used by scheduled runs to inject dynamic expressions), submits the resulting
    spec to cascade, and persists a JobExecution row. When ``execution_id`` is
    supplied, the new attempt is appended under that existing id (restart semantics);
    otherwise a fresh id is generated. Experiment metadata is stored on the row when
    provided and is preserved on restart.
    """
    if not definition.blocks:
        return Either.error(f"JobDefinition {definition.job_definition_id!r} has no compilable blocks")

    definition_id = str(definition.job_definition_id)  # ty:ignore[invalid-argument-type]
    definition_version = cast(int, definition.version)

    builder = FableBuilder(
        blocks=definition.blocks,  # ty:ignore[invalid-argument-type]
        environment=EnvironmentSpecification.model_validate(definition.environment_spec) if definition.environment_spec else None,
    )
    compiled = compile_builder(builder)

    if compiler_runtime_context:
        exec_spec = ExecutionSpecification.model_validate(deep_union(compiled.model_dump(), compiler_runtime_context))
    else:
        exec_spec = compiled

    new_execution_id, attempt_count = await job_execution_db.upsert_job_execution(
        job_execution_id=execution_id,
        job_definition_id=definition_id,
        job_definition_version=definition_version,
        created_by=auth_context.user_id,
        status="submitted",
        experiment_id=experiment_id,
        experiment_version=experiment_version,
        compiler_runtime_context=compiler_runtime_context,
        experiment_context=experiment_context,
    )

    try:
        loop = asyncio.get_running_loop()
        response, product_to_id_mappings = await loop.run_in_executor(None, _execute_cascade, exec_spec)
        cascade_job_id = response.job_id or str(uuid.uuid4())

        update_kwargs: dict[str, object] = {"cascade_job_id": cascade_job_id}
        if response.error:
            update_kwargs["status"] = "failed"
            update_kwargs["error"] = response.error[:255]
        else:
            update_kwargs["outputs"] = [x.model_dump() for x in product_to_id_mappings]
        await job_execution_db.update_job_execution_runtime(new_execution_id, attempt_count, **update_kwargs)

        return Either.ok(JobExecuteResponse(execution_id=new_execution_id, attempt_count=attempt_count))
    except Exception as e:
        await job_execution_db.update_job_execution_runtime(new_execution_id, attempt_count, status="failed", error=repr(e)[:255])
        return Either.error(repr(e))


async def restart_job_execution(execution_id: str, auth_context: AuthContext) -> Either[JobExecuteResponse, str]:  # type: ignore[invalid-argument]
    """Create a new attempt under an existing execution_id, re-running its linked JobDefinition.

    Raises ``JobExecutionNotFound`` if the execution does not exist.
    Raises ``JobExecutionAccessDenied`` if the actor does not own the execution.
    """
    existing = await job_execution_db.get_job_execution(execution_id, auth_context=auth_context)
    # get_job_execution raises JobExecutionNotFound / JobExecutionAccessDenied on failure.

    definition_id = str(existing.job_definition_id)  # ty:ignore[invalid-argument-type]
    definition_version = cast(int, existing.job_definition_version)
    definition = await job_definition_db.get_job_definition(definition_id, definition_version)
    if definition is None:
        return Either.error(f"JobDefinition {definition_id!r} v{definition_version} not found")

    return await execute(
        definition,
        auth_context,
        execution_id=execution_id,
        experiment_id=cast(str | None, existing.experiment_id),
        experiment_version=cast(int | None, existing.experiment_version),
        compiler_runtime_context=cast(dict | None, existing.compiler_runtime_context),
        experiment_context=cast(str | None, existing.experiment_context),
    )


def execution_to_detail(execution: JobExecution) -> JobExecutionDetail:
    """Convert a JobExecution ORM row to a JobExecutionDetail response model."""
    return JobExecutionDetail(
        execution_id=str(execution.job_execution_id),  # ty:ignore[invalid-argument-type]
        attempt_count=cast(int, execution.attempt_count),
        status=cast(str, execution.status),
        created_at=str(execution.created_at),
        updated_at=str(execution.updated_at),
        job_definition_id=str(execution.job_definition_id),  # ty:ignore[invalid-argument-type]
        job_definition_version=cast(int, execution.job_definition_version),
        error=cast(str | None, execution.error),
        progress=cast(str | None, execution.progress),
        cascade_job_id=cast(str | None, execution.cascade_job_id),
    )


async def poll_and_update_execution(
    execution_id: str,
    attempt_count: int | None,
    auth_context: AuthContext,
) -> JobExecutionDetail:
    """Fetch a JobExecution, poll cascade if active, update db, and return current detail.

    Raises ``JobExecutionNotFound`` if the execution is not found.
    Raises ``JobExecutionAccessDenied`` if the actor does not own it.
    """
    execution = await job_execution_db.get_job_execution(execution_id, attempt_count, auth_context=auth_context)

    actual_attempt = cast(int, execution.attempt_count)
    cascade_job_id = cast(str | None, execution.cascade_job_id)
    status = cast(str, execution.status)

    def _build(
        status_override: str | None = None, error_override: str | None = None, progress_override: str | None = None
    ) -> JobExecutionDetail:
        return JobExecutionDetail(
            execution_id=str(execution.job_execution_id),  # ty:ignore[invalid-argument-type]
            attempt_count=actual_attempt,
            status=status_override or status,
            created_at=str(execution.created_at),
            updated_at=str(execution.updated_at),
            job_definition_id=str(execution.job_definition_id),  # ty:ignore[invalid-argument-type]
            job_definition_version=cast(int, execution.job_definition_version),
            error=error_override if error_override is not None else cast(str | None, execution.error),
            progress=progress_override if progress_override is not None else cast(str | None, execution.progress),
            cascade_job_id=cascade_job_id,
        )

    if status in ("submitted", "preparing", "running") and cascade_job_id:
        try:
            response = client.request_response(api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}")
            response = cast(api.JobProgressResponse, response)
        except TimeoutError:
            return _build(status_override="unknown", error_override="failed to communicate with gateway")
        except Exception as e:
            return _build(status_override="unknown", error_override=f"internal cascade failure: {repr(e)}")

        if response.error:
            return _build(status_override="unknown", error_override=response.error)

        jobprogress = response.progresses.get(cascade_job_id)
        if jobprogress is None:
            await job_execution_db.update_job_execution_runtime(execution_id, actual_attempt, status="failed", error="evicted from gateway")
            return _build(status_override="failed", error_override="evicted from gateway")
        elif jobprogress.failure:
            await job_execution_db.update_job_execution_runtime(execution_id, actual_attempt, status="failed", error=jobprogress.failure)
            return _build(status_override="failed", error_override=jobprogress.failure)
        elif jobprogress.completed or jobprogress.pct == "100.00":
            await job_execution_db.update_job_execution_runtime(execution_id, actual_attempt, status="completed", progress="100.00")
            return _build(status_override="completed", progress_override="100.00")
        else:
            await job_execution_db.update_job_execution_runtime(execution_id, actual_attempt, status="running", progress=jobprogress.pct)
            return _build(status_override="running", progress_override=jobprogress.pct)

    return _build()


async def get_job_execution_specification(
    execution_id: str,
    attempt_count: int | None,
    auth_context: AuthContext,
) -> JobSpecification:
    """Return the JobSpecification for the given execution attempt (latest if attempt_count is None).

    Raises ``JobExecutionNotFound`` if the execution is not found.
    Raises ``JobExecutionAccessDenied`` if the actor does not own it.
    """
    execution = await job_execution_db.get_job_execution(execution_id, attempt_count, auth_context=auth_context)
    definition = await job_definition_db.get_job_definition(
        str(execution.job_definition_id),  # ty:ignore[invalid-argument-type]
        cast(int, execution.job_definition_version),
    )
    if definition is None:
        raise JobExecutionNotFound(f"JobDefinition linked to execution {execution_id!r} not found.")
    return JobSpecification(
        definition_id=str(definition.job_definition_id),  # ty:ignore[invalid-argument-type]
        definition_version=cast(int, definition.version),
        blocks=cast(dict | None, definition.blocks),
        environment_spec=cast(dict | None, definition.environment_spec),
    )
