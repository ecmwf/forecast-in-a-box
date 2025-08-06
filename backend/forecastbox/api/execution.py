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
from typing import Any

import cascade.gateway.api as api
import cascade.gateway.client as client
from cascade.low import views as cascade_views
from cascade.low.core import JobInstance
from cascade.low.func import assert_never
from cascade.low.into import graph2job
from earthkit.workflows import Cascade, fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes
from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, ForecastProducts, RawCascadeJob
from forecastbox.api.utils import get_model_path
from forecastbox.config import config
from forecastbox.db.job import insert_one
from forecastbox.models import Model
from forecastbox.products.registry import get_product
from forecastbox.schemas.user import UserRead
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def forecast_products_to_cascade(spec: ForecastProducts, environment: EnvironmentSpecification) -> Cascade:
    # Get the model specification and create a Model instance
    model_spec = dict(
        lead_time=spec.model.lead_time,
        date=spec.model.date,
        ensemble_members=spec.model.ensemble_members,
    )

    model = Model(checkpoint_path=get_model_path(spec.model.model), **model_spec)

    # Create the model action graph
    model_action = model.graph(None, environment_kwargs=environment.environment_variables, **spec.model.entries)

    # Iterate over each product in the specification
    complete_graph = Graph([])
    for product in spec.products:
        product_spec = product.specification.copy()
        try:
            product_graph = get_product(*product.product.split("/", 1)).execute(product_spec, model, model_action)
        except Exception as e:
            raise Exception(f"Error in product {product}:\n{e}")

        if isinstance(product_graph, fluent.Action):
            product_graph = product_graph.graph()
        complete_graph += product_graph

    if len(spec.products) == 0:
        complete_graph += model_action.graph()

    return Cascade(deduplicate_nodes(complete_graph))


def execution_specification_to_cascade(spec: ExecutionSpecification) -> JobInstance:
    if isinstance(spec.job, ForecastProducts):
        cascade_graph = forecast_products_to_cascade(spec.job, spec.environment)
        return graph2job(cascade_graph._graph)
    elif isinstance(spec.job, RawCascadeJob):
        return spec.job.job_instance
    else:
        assert_never(spec.job)


def _execute_cascade(spec: ExecutionSpecification) -> tuple[api.SubmitJobResponse, list[Any]]:
    """Converts spec to JobInstance and submits to cascade api, returning response + list of sinks"""
    try:
        job = execution_specification_to_cascade(spec)
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=repr(e)), []

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    job.ext_outputs = sinks

    environment = spec.environment

    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.max_hosts)
    workers_per_host = min(
        config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.max_workers_per_host
    )

    env_vars = {"TMPDIR": config.cascade.venv_temp_dir}
    env_vars.update(environment.environment_variables)

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

    return submit_job_response, sinks


class SubmitJobResponse(BaseModel):
    """Submit Job Response."""

    id: str
    """Id of the submitted job."""


async def execute(spec: ExecutionSpecification, user: UserRead | None) -> SubmitJobResponse:
    loop = asyncio.get_running_loop()
    response, sinks = await loop.run_in_executor(None, _execute_cascade, spec)  # CPU-bound
    if not response.job_id:
        # TODO this best comes from the db... we still have a cascade conflict problem,
        # we best redesign cascade api to allow for uuid acceptance
        response.job_id = str(uuid.uuid4())
    await insert_one(
        response.job_id,
        response.error,
        str(user.id) if user else None,
        spec.model_dump_json(),
        json.dumps(list(map(lambda x: x.task, sinks))),
    )
    return SubmitJobResponse(id=response.job_id)
