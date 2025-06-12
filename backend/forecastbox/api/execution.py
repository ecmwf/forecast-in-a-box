# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from datetime import datetime

import logging

from earthkit.workflows import Cascade, fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes

from cascade.low.into import graph2job
from cascade.low.core import JobInstance
from cascade.low.func import assert_never
from cascade.low import views as cascade_views

import cascade.gateway.api as api
import cascade.gateway.client as client

from forecastbox.products.registry import get_product
from forecastbox.models import Model

from forecastbox.db import db
from forecastbox.schemas.user import UserRead

from forecastbox.config import config

from forecastbox.api.utils import get_model_path
from forecastbox.api.types import ExecutionSpecification, RawCascadeJob, EnsembleProducts, EnvironmentSpecification

LOG = logging.getLogger(__name__)


def ensemble_products_to_cascade(spec: EnsembleProducts, environment: EnvironmentSpecification) -> Cascade:
    # Get the model specification and create a Model instance
    model_spec = dict(
        lead_time=spec.model.lead_time,
        date=spec.model.date,
        ensemble_members=spec.model.ensemble_members,
    )

    model = Model(checkpoint_path=get_model_path(spec.model.model), **model_spec)

    # Create the model action graph
    model_action = model.graph(None, **spec.model.entries, environment_kwargs=environment.environment_variables)

    # Iterate over each product in the specification
    complete_graph = Graph([])
    for product in spec.products:
        product_spec = product.specification.copy()
        try:
            product_graph = get_product(*product.product.split("/", 1)).to_graph(product_spec, model, model_action)
        except Exception as e:
            raise Exception(f"Error in product {product}:\n{e}")

        if isinstance(product_graph, fluent.Action):
            product_graph = product_graph.graph()
        complete_graph += product_graph

    if len(spec.products) == 0:
        complete_graph += model_action.graph()

    return Cascade(deduplicate_nodes(complete_graph))


def execution_specification_to_cascade(spec: ExecutionSpecification) -> JobInstance:
    if isinstance(spec.job, EnsembleProducts):
        cascade_graph = ensemble_products_to_cascade(spec.job, spec.environment)
        return graph2job(cascade_graph._graph)
    elif isinstance(spec.job, RawCascadeJob):
        return spec.job.job_instance
    else:
        assert_never(spec.job)


def execute(spec: ExecutionSpecification, id: str, user: UserRead) -> api.SubmitJobResponse | None:
    """
    Execute a job based on the provided execution specification.

    Converts the execution specification into a Cascade graph, prepares the job for submission,
    and submits it to the Cascade gateway.

    Will update the job record in the database with the job ID and status.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    id : str
        Id of the job record in the database.
    user : UserRead
        User object representing the user executing the job.

    Returns
    -------
    api.SubmitJobResponse
        The response from the Cascade gateway after submitting the job
    """
    collection = db.get_collection("job_records")

    try:
        job = execution_specification_to_cascade(spec)
    except Exception as e:
        collection.update_one({"id": id}, {"$set": {"error": str(e)}})
        return api.SubmitJobResponse(job_id=None, error=str(e))

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    job.ext_outputs = sinks

    environment = spec.environment

    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.max_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.max_workers_per_host)

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
        collection.update_one({"id": id}, {"$set": {"error": "Failed to submit job - " + str(e)}})
        return api.SubmitJobResponse(job_id=None, error=str(e))

    # Record the job_id and graph specification
    record = {
        "job_id": submit_job_response.job_id,
        "status": "submitted",
        "error": None,
        "updated_at": datetime.now(),
        "created_by": str(user.id) if user else None,
        "outputs": list(map(lambda x: x.task, sinks)),
    }
    collection = db.get_collection("job_records")
    collection.update_one({"id": id}, {"$set": record})

    return submit_job_response
