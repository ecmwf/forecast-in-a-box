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

import forecastbox.domain.run.db as run_db
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.run.cascade import ExecutionSpecification, execute_cascade
from forecastbox.domain.run.compile import compile_builder, merge_glyph_values, resolve_intrinsic_glyph_values
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.schemata.jobs import Blueprint
from forecastbox.utility.structural import deep_union
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


def execute_background(
    run_id: str,
    attempt_count: int,
    submit_time: datetime,
    blueprint: Blueprint,
    compiler_runtime_context: CompilerRuntimeContext,
    loop: asyncio.AbstractEventLoop,
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

        all_glyphs = merge_glyph_values(intrinsic_values, compiler_runtime_context.glyphs)

        builder = BlueprintBuilder(
            blocks=blueprint.blocks,  # ty:ignore[invalid-argument-type]
            environment=EnvironmentSpecification.model_validate(blueprint.environment_spec) if blueprint.environment_spec else None,
        )
        compiled = compile_builder(builder, all_glyphs)

        exec_spec = ExecutionSpecification.model_validate(
            deep_union(compiled.model_dump(), compiler_runtime_context.model_dump(exclude_unset=True))
        )

        persisted_context = compiler_runtime_context.model_copy(update={"glyphs": all_glyphs})
        run_async(
            run_db.update_run_runtime(
                run_id,
                attempt_count,
                compiler_runtime_context=persisted_context.model_dump(exclude_unset=True),
                status="preparing",
            )
        )

        response, product_to_id_mappings = execute_cascade(exec_spec)
        cascade_job_id = response.job_id or str(uuid.uuid4())

        update_kwargs: dict[str, object] = {"cascade_job_id": cascade_job_id}
        if response.error:
            update_kwargs["status"] = "failed"
            update_kwargs["error"] = response.error[:255]
        else:
            update_kwargs["outputs"] = [x.model_dump() for x in product_to_id_mappings]
        run_async(run_db.update_run_runtime(run_id, attempt_count, **update_kwargs))

    except Exception as e:
        logger.exception(f"execute_background failed for run {run_id!r} attempt {attempt_count}: {e}")
        run_async(run_db.update_run_runtime(run_id, attempt_count, status="failed", error=repr(e)[:255]))
