"""Products API Router."""

from datetime import datetime
from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

from typing import Union
import tempfile

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from .models import get_model_path
from ..types import GraphSpecification

from earthkit.workflows import Cascade
from cascade.low.into import graph2job
from cascade.low import views as cascade_views

from cascade.low.core import JobInstance, DatasetId
from cascade.controller.report import JobId, JobProgress

import cascade.gateway.api as api
import cascade.gateway.client as client

from ..database import db

from forecastbox.settings import APISettings, CascadeSettings

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)

API_SETTINGS = APISettings()
CASCADE_SETTINGS = CascadeSettings()

class SubmitResponse(api.SubmitJobResponse):
    output_ids: set[DatasetId]


async def convert_to_cascade(spec: GraphSpecification) -> Cascade:
    """Convert a specification to a cascade."""

    model_spec = dict(
        lead_time=spec.model.lead_time,
        date=spec.model.date,
        ensemble_members=spec.model.ensemble_members,
    )
    model_action = Model(get_model_path(spec.model.model), **model_spec).graph(None, **spec.model.entries)

    actions = []

    for product in spec.products:
        product_action = get_product(*product.product.split("/", 1)).to_graph(product.specification, model_action)
        actions.append(product_action)

    if len(spec.products) == 0:
        actions.append(model_action)

    return Cascade.from_actions(actions)


@router.post("/visualise", response_model=str)
async def get_graph_visualise(spec: GraphSpecification) -> HTMLResponse:
    """Get an HTML visualisation of the product graph."""
    graph = await convert_to_cascade(spec)

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, preset="blob")

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")

@router.post("/serialise")
async def get_graph_serialised(spec: GraphSpecification) -> JobInstance:
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    return graph2job(graph._graph)


@router.post("/execute")
async def execute_api(spec: GraphSpecification) -> api.SubmitJobResponse:
    return await execute(spec)

async def execute(spec: GraphSpecification) -> api.SubmitJobResponse:
    """Get serialised dump of product graph."""
    try:
        graph = await convert_to_cascade(spec)
    except Exception as e:
        return api.SubmitJobResponse(job_id = None, error=str(e))
    
    job = graph2job(graph._graph)

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    job.ext_outputs = sinks

    # Manual GPU allocation
    for task_id, task in job.tasks.items():
        if task_id.startswith("run_as_earthkit"):
            task.definition.needs_gpu = True

    r = api.SubmitJobRequest(
        job=api.JobSpec(benchmark_name=None, workers_per_host=CASCADE_SETTINGS.workers_per_host, hosts=CASCADE_SETTINGS.hosts, envvars={}, use_slurm=False, job_instance=job)
    )
    submit_job_response: api.SubmitJobResponse = client.request_response(r, f"{CASCADE_SETTINGS.cascade_url}")  # type: ignore


    # Check if the job was submitted successfully
    if submit_job_response.error:
        raise Exception(f"Job submission failed: {submit_job_response.error}")

    # Record the job_id and graph specification
    record = {
        "job_id": submit_job_response.job_id,
        "graph_specification": spec,
        "status": "submitted",
        "created_at": datetime.now(),
        "outputs": list(map(lambda x: x.task, sinks)),
    }
    db.insert_one("job_records", record)

    # submit_response = SubmitResponse(**submit_job_response.model_dump(), output_ids=sinks)
    return submit_job_response
