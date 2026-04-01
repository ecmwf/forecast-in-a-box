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

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.run.db as run_db
from forecastbox.api.artifacts.manager import ArtifactManager, submit_artifact_download
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification, ExecutionSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder, compile_builder
from forecastbox.domain.run.exceptions import RunNotFound
from forecastbox.ecpyutil import deep_union
from forecastbox.schemata.jobs import Blueprint, Run
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)


class RunDetail(BaseModel):
    """Detail of a single job execution attempt."""

    run_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    blueprint_id: str
    blueprint_version: int
    error: str | None = None
    progress: str | None = None
    cascade_job_id: str | None = None


class ExecuteResult(BaseModel):
    """Result of a job execution submission."""

    run_id: str
    """Logical execution id (Run.id)."""
    attempt_count: int
    """Attempt number; always 1 on a fresh execution."""


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


async def get_blueprint_for_execution(blueprint_id: str, blueprint_version: int | None) -> Blueprint | None:
    """Retrieve a Blueprint from the jobs store by id and optional version."""
    return await blueprint_db.get_blueprint(blueprint_id, blueprint_version)


async def execute(
    blueprint: Blueprint,
    auth_context: AuthContext,
    run_id: str | None = None,
    experiment_id: str | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: dict | None = None,
    experiment_context: str | None = None,
) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
    """Always creates a Run linked to the given Blueprint.

    Compiles the blueprint's blocks via the blueprint compiler, applies
    compiler_runtime_context (if given) via deep_union to override compiled values
    (used by scheduled runs to inject dynamic expressions), submits the resulting
    spec to cascade, and persists a Run row. When ``run_id`` is
    supplied, the new attempt is appended under that existing id (restart semantics);
    otherwise a fresh id is generated. Experiment metadata is stored on the row when
    provided and is preserved on restart.
    """
    if not blueprint.blocks:
        return Either.error(f"Blueprint {blueprint.blueprint_id!r} has no compilable blocks")

    blueprint_id = str(blueprint.blueprint_id)  # ty:ignore[invalid-argument-type]
    blueprint_version = cast(int, blueprint.version)

    builder = BlueprintBuilder(
        blocks=blueprint.blocks,  # ty:ignore[invalid-argument-type]
        environment=EnvironmentSpecification.model_validate(blueprint.environment_spec) if blueprint.environment_spec else None,
    )
    compiled = compile_builder(builder)

    if compiler_runtime_context:
        exec_spec = ExecutionSpecification.model_validate(deep_union(compiled.model_dump(), compiler_runtime_context))
    else:
        exec_spec = compiled

    new_run_id, attempt_count = await run_db.upsert_run(
        run_id=run_id,
        blueprint_id=blueprint_id,
        blueprint_version=blueprint_version,
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
        await run_db.update_run_runtime(new_run_id, attempt_count, **update_kwargs)

        return Either.ok(ExecuteResult(run_id=new_run_id, attempt_count=attempt_count))
    except Exception as e:
        await run_db.update_run_runtime(new_run_id, attempt_count, status="failed", error=repr(e)[:255])
        return Either.error(repr(e))


async def restart_run(run_id: str, auth_context: AuthContext) -> Either[ExecuteResult, str]:  # type: ignore[invalid-argument]
    """Create a new attempt under an existing run_id, re-running its linked Blueprint.

    Raises ``RunNotFound`` if the execution does not exist.
    Raises ``RunAccessDenied`` if the actor does not own the execution.
    """
    existing = await run_db.get_run(run_id, auth_context=auth_context)
    # get_run raises RunNotFound / RunAccessDenied on failure.

    blueprint_id = str(existing.blueprint_id)  # ty:ignore[invalid-argument-type]
    blueprint_version = cast(int, existing.blueprint_version)
    blueprint = await blueprint_db.get_blueprint(blueprint_id, blueprint_version)
    if blueprint is None:
        return Either.error(f"Blueprint {blueprint_id!r} v{blueprint_version} not found")

    return await execute(
        blueprint,
        auth_context,
        run_id=run_id,
        experiment_id=cast(str | None, existing.experiment_id),
        experiment_version=cast(int | None, existing.experiment_version),
        compiler_runtime_context=cast(dict | None, existing.compiler_runtime_context),
        experiment_context=cast(str | None, existing.experiment_context),
    )


def execution_to_detail(execution: Run) -> RunDetail:
    """Convert a Run ORM row to a RunDetail response model."""
    return RunDetail(
        run_id=str(execution.run_id),  # ty:ignore[invalid-argument-type]
        attempt_count=cast(int, execution.attempt_count),
        status=cast(str, execution.status),
        created_at=str(execution.created_at),
        updated_at=str(execution.updated_at),
        blueprint_id=str(execution.blueprint_id),  # ty:ignore[invalid-argument-type]
        blueprint_version=cast(int, execution.blueprint_version),
        error=cast(str | None, execution.error),
        progress=cast(str | None, execution.progress),
        cascade_job_id=cast(str | None, execution.cascade_job_id),
    )


async def poll_and_update_execution(
    run_id: str,
    attempt_count: int | None,
    auth_context: AuthContext,
) -> RunDetail:
    """Fetch a Run, poll cascade if active, update db, and return current detail.

    Raises ``RunNotFound`` if the execution is not found.
    Raises ``RunAccessDenied`` if the actor does not own it.
    """
    execution = await run_db.get_run(run_id, attempt_count, auth_context=auth_context)

    actual_attempt = cast(int, execution.attempt_count)
    cascade_job_id = cast(str | None, execution.cascade_job_id)
    status = cast(str, execution.status)

    def _build(status_override: str | None = None, error_override: str | None = None, progress_override: str | None = None) -> RunDetail:
        return RunDetail(
            run_id=str(execution.run_id),  # ty:ignore[invalid-argument-type]
            attempt_count=actual_attempt,
            status=status_override or status,
            created_at=str(execution.created_at),
            updated_at=str(execution.updated_at),
            blueprint_id=str(execution.blueprint_id),  # ty:ignore[invalid-argument-type]
            blueprint_version=cast(int, execution.blueprint_version),
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
            await run_db.update_run_runtime(run_id, actual_attempt, status="failed", error="evicted from gateway")
            return _build(status_override="failed", error_override="evicted from gateway")
        elif jobprogress.failure:
            await run_db.update_run_runtime(run_id, actual_attempt, status="failed", error=jobprogress.failure)
            return _build(status_override="failed", error_override=jobprogress.failure)
        elif jobprogress.completed or jobprogress.pct == "100.00":
            await run_db.update_run_runtime(run_id, actual_attempt, status="completed", progress="100.00")
            return _build(status_override="completed", progress_override="100.00")
        else:
            await run_db.update_run_runtime(run_id, actual_attempt, status="running", progress=jobprogress.pct)
            return _build(status_override="running", progress_override=jobprogress.pct)

    return _build()
