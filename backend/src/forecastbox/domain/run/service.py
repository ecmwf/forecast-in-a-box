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
import uuid
from datetime import datetime, timezone
from typing import cast

import cascade.gateway.api as api
import cascade.gateway.client as client
from cascade.low.func import Either
from pydantic import BaseModel

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.run.db as run_db
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.run.cascade import ExecutionSpecification, ProductToOutputId, execute_cascade
from forecastbox.domain.run.compile import compile_builder, resolve_automatic_values
from forecastbox.domain.run.exceptions import RunNotFound
from forecastbox.schemata.jobs import Blueprint, Run
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config
from forecastbox.utility.structural import deep_union

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

    # Generate run_id before compilation so it can be used as a variable value.
    effective_run_id = run_id or str(uuid.uuid4())
    submit_datetime = datetime.now(timezone.utc)
    automatic_values: dict[str, str] = cast(dict[str, str], resolve_automatic_values(effective_run_id, submit_datetime))

    builder = BlueprintBuilder(
        blocks=blueprint.blocks,  # ty:ignore[invalid-argument-type]
        environment=EnvironmentSpecification.model_validate(blueprint.environment_spec) if blueprint.environment_spec else None,
    )
    compiled = compile_builder(builder, automatic_values)

    if compiler_runtime_context:
        exec_spec = ExecutionSpecification.model_validate(deep_union(compiled.model_dump(), compiler_runtime_context))
    else:
        exec_spec = compiled

    new_run_id, attempt_count = await run_db.upsert_run(
        run_id=effective_run_id,
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
        response, product_to_id_mappings = await loop.run_in_executor(None, execute_cascade, exec_spec)
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


async def poll_and_update(execution: Run) -> RunDetail:
    """Poll cascade for a Run's status, update db if changed, and return current detail."""
    run_id = str(execution.run_id)  # ty:ignore[invalid-argument-type]
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
