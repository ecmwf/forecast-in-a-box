"""Products API Router."""

from fastapi import APIRouter, Response

from typing import Union

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from .models import get_model_path
from ..types import GraphSpecification

from cascade import Cascade
from cascade.graph.pyvis import PRESET_OPTIONS
from cascade.low.into import graph2job

from cascade.low.core import JobInstance, DatasetId
from cascade.low import views as cascade_views
from cascade.controller.report import JobId, JobProgress

import cascade.gateway.api as api
import cascade.gateway.client as client

import tempfile
from forecastbox.settings import get_settings

router = APIRouter(
	tags=["graph"],
	responses={404: {"description": "Not found"}},
)

SETTINGS = get_settings()

class SubmitResponse(api.SubmitJobResponse):
    output_ids: set[DatasetId]

async def convert_to_cascade(spec: GraphSpecification) -> Cascade:
    """Convert a specification to a cascade."""

    model_spec = dict(lead_time =spec.model.lead_time, date = spec.model.date, ensemble_members = spec.model.ensemble_members,)
    model_action = Model(get_model_path(spec.model.model), **model_spec).graph(None, **spec.model.entries)
    
    actions = []

    for product in spec.products:
        product_action = get_product(*product.product.split('/', 1)).to_graph(product.specification, model_action)
        actions.append(product_action)

    if len(spec.products) == 0:
        actions.append(model_action)

    return Cascade.from_actions(actions)


@router.post("/visualise", response_model=str)
async def get_graph_visualise(spec: GraphSpecification, preset: PRESET_OPTIONS = 'blob') -> Response:
    """Get an HTML visualisation of the product graph."""
    graph = await convert_to_cascade(spec)
    
    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, preset = preset)

        with open(dest.name, 'r') as f:
            return Response(f.read(), media_type="text/html")

@router.post("/serialise")
async def get_graph_serialised(spec: GraphSpecification) -> JobInstance:
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    return graph2job(graph._graph)

@router.post("/execute")
async def execute(spec: GraphSpecification) -> SubmitResponse:
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    job = graph2job(graph._graph)

    # Manual GPU allocation
    for task_id, task in job.tasks.items():
        if task_id.startswith('run_as_earthkit'):
            task.definition.needs_gpu = True

    sinks = cascade_views.sinks(job)
            
    request = api.SubmitJobRequest(job=api.JobSpec(benchmark_name=None, workers_per_host=2, hosts=2, envvars={}, use_slurm=False, job_instance=job))
    response = client.request_response(request, f"{SETTINGS.cascade_url}")

    submit_response = SubmitResponse(**response.model_dump(), output_ids=sinks)
    return submit_response

@router.post('/progress')
async def get_progress(request: api.JobProgressRequest) -> api.JobProgressResponse:
    return client.request_response(request, f"{SETTINGS.cascade_url}") # type: ignore

@router.post('/result')
async def get_result(request: api.ResultRetrievalRequest) -> api.ResultRetrievalResponse:
    return client.request_response(request, f"{SETTINGS.cascade_url}") # type: ignore
