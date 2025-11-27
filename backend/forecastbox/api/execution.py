# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import asyncio
import json
import logging
import uuid
from typing import Any, Sequence

import cascade.gateway.api as api
import cascade.gateway.client as client
from cascade.low import views as cascade_views
from cascade.low.core import JobInstance
from cascade.low.func import Either, assert_never
from cascade.low.into import graph2job
from earthkit.workflows import Cascade, fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fastapi import HTTPException
from pydantic import BaseModel

from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, ForecastProducts, RawCascadeJob
from forecastbox.api.utils import get_model_path
from forecastbox.config import config
from forecastbox.db.job import insert_one
from forecastbox.models import get_model
from forecastbox.products.registry import get_product
from forecastbox.schemas.user import UserRead

logger = logging.getLogger(__name__)


def _get_model(spec: ForecastProducts):
    model_spec = dict(
        lead_time=spec.model.lead_time,
        date=spec.model.date,
        ensemble_members=spec.model.ensemble_members,
    )

    return get_model(checkpoint=get_model_path(spec.model.model)).specify(**model_spec)  # type: ignore


class ProductToOutputId(BaseModel):
    product_name: str
    product_spec: dict[str, Any]
    output_ids: Sequence[str]


def forecast_products_to_cascade(
    spec: ForecastProducts, environment: EnvironmentSpecification
) -> tuple[Cascade, dict, list[ProductToOutputId]]:
    model = _get_model(spec)

    # Create the model action graph
    model_action = model.graph()

    # Iterate over each product in the specification
    complete_graph = Graph([])

    product_to_id_mappings = []

    for product in spec.products:
        product_spec = product.specification.copy()
        try:
            product_graph = get_product(*product.product.split("/", 1)).execute(product_spec, model, model_action)
        except Exception as e:
            raise Exception(f"Error in product {product}:\n{e}")

        if isinstance(product_graph, fluent.Action):
            product_graph = product_graph.graph()

        output_ids = [x.name for x in product_graph.sinks]
        product_to_id_mappings.append(ProductToOutputId(product_name=product.product, product_spec=product_spec, output_ids=output_ids))

        complete_graph += product_graph

    if len(spec.products) == 0:
        complete_graph += model_action.graph()
        product_to_id_mappings.append(
            ProductToOutputId(product_name="All Model Outputs", product_spec={}, output_ids=[x.name for x in model_action.graph().sinks])
        )

    env_vars = model.control.environment_variables
    env_vars.update(environment.environment_variables)

    return Cascade(deduplicate_nodes(complete_graph)), env_vars, product_to_id_mappings


def execution_specification_to_cascade(spec: ExecutionSpecification) -> tuple[JobInstance, dict, list[ProductToOutputId] | None]:
    if isinstance(spec.job, ForecastProducts):
        cascade_graph, environment_variables, product_to_id_mappings = forecast_products_to_cascade(spec.job, spec.environment)
        return graph2job(cascade_graph._graph), environment_variables, product_to_id_mappings
    elif isinstance(spec.job, RawCascadeJob):
        return spec.job.job_instance, {}, None
    assert_never(spec.job)


def _execute_cascade(spec: ExecutionSpecification) -> tuple[api.SubmitJobResponse, list[ProductToOutputId]]:
    """Converts spec to JobInstance and submits to cascade api, returning response + list of sinks"""
    try:
        job, job_envvars, product_to_id_mappings = execution_specification_to_cascade(spec)
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=repr(e)), []

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    if not product_to_id_mappings:
        product_to_id_mappings = [ProductToOutputId(product_name="All Outputs", product_spec={}, output_ids=[x.task for x in sinks])]

    job.ext_outputs = sinks

    environment = spec.environment

    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.max_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.max_workers_per_host)

    env_vars = {"TMPDIR": config.cascade.venv_temp_dir}
    env_vars.update({k: str(v) for k, v in job_envvars.items()})

    r = api.SubmitJobRequest(
        job=api.JobSpec(
            benchmark_name=None,
            workers_per_host=workers_per_host,
            hosts=hosts,
            envvars=env_vars,
            use_slurm=False,
            job_instance=job,
        )
    )
    try:
        submit_job_response: api.SubmitJobResponse = client.request_response(r, f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=repr(e)), []

    return submit_job_response, product_to_id_mappings


class SubmitJobResponse(BaseModel):
    """Submit Job Response."""

    id: str
    """Id of the submitted job."""


async def execute(spec: ExecutionSpecification, user_id: str | None) -> Either[SubmitJobResponse, str]:  # type: ignore[invalid-argument] # NOTE type checker issue
    try:
        loop = asyncio.get_running_loop()
        response, product_to_id_mappings = await loop.run_in_executor(None, _execute_cascade, spec)  # CPU-bound
        if not response.job_id:
            # TODO this best comes from the db... we still have a cascade conflict problem,
            # we best redesign cascade api to allow for uuid acceptance
            response.job_id = str(uuid.uuid4())

        await insert_one(
            response.job_id,
            response.error,
            user_id,
            spec.model_dump_json(),
            json.dumps([x.model_dump() for x in product_to_id_mappings]),
        )
        return Either.ok(SubmitJobResponse(id=response.job_id))
    except Exception as e:
        return Either.error(repr(e))


async def execute2response(spec: ExecutionSpecification, user: UserRead | None) -> SubmitJobResponse:
    result = await execute(spec, str(user.id) if user is not None else None)
    if result.e is not None:
        raise HTTPException(status_code=500, detail=f"Failed to execute because of {result.error}")
    else:
        return result.t
