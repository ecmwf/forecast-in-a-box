"""Graph API Router."""

from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

import tempfile
import logging

from forecastbox.products.registry import get_product
from forecastbox.models import Model

from .model import get_model_path
from ..types import ExecutionSpecification

from earthkit.workflows import Cascade, fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes

from cascade.low.into import graph2job
from cascade.low import views as cascade_views

from cascade.low.core import JobInstance, DatasetId

import cascade.gateway.api as api
import cascade.gateway.client as client

from ...db import db

from forecastbox.settings import CASCADE_SETTINGS
from forecastbox.api.types import VisualisationOptions

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)

LOG = logging.getLogger(__name__)


class SubmitResponse(api.SubmitJobResponse):
    output_ids: set[DatasetId]


async def convert_to_cascade(spec: ExecutionSpecification) -> Cascade:
    """Convert a specification to a cascade."""

    model_spec = dict(
        lead_time=spec.model.lead_time,
        date=spec.model.date,
        ensemble_members=spec.model.ensemble_members,
    )
    model = Model(checkpoint_path=get_model_path(spec.model.model), **model_spec)
    model_action = model.graph(None, **spec.model.entries)

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


@router.post("/visualise")
async def get_graph_visualise(spec: ExecutionSpecification, options: VisualisationOptions = None) -> HTMLResponse:
    """Get an HTML visualisation of the product graph."""
    if options is None:
        options = VisualisationOptions()

    try:
        graph = await convert_to_cascade(spec)
    except Exception as e:
        LOG.error(f"Error converting to cascade: {e}")
        return HTMLResponse(str(e), status_code=500)

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, **options.model_dump())

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")


@router.post("/serialise")
async def get_graph_serialised(spec: ExecutionSpecification) -> JobInstance:
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    return graph2job(graph._graph)


@router.post("/download")
async def get_graph_download(spec: ExecutionSpecification) -> str:
    """Get downloadable json of the graph."""
    return spec.model_dump_json()


@router.post("/execute")
async def execute_api(spec: ExecutionSpecification) -> api.SubmitJobResponse:
    response = await execute(spec)
    if response.error:
        raise HTTPException(status_code=500, detail=response.error)
    return response


async def execute(spec: ExecutionSpecification) -> api.SubmitJobResponse:
    """Get serialised dump of product graph."""
    try:
        cascade_graph = await convert_to_cascade(spec)
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=str(e))

    model_path = get_model_path(spec.model.model)

    job = graph2job(cascade_graph._graph)

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    job.ext_outputs = sinks

    hosts = CASCADE_SETTINGS.max_hosts
    workers_per_host = CASCADE_SETTINGS.max_workers_per_host

    r = api.SubmitJobRequest(
        job=api.JobSpec(benchmark_name=None, workers_per_host=workers_per_host, hosts=hosts, envvars={}, use_slurm=False, job_instance=job)
    )
    try:
        submit_job_response: api.SubmitJobResponse = client.request_response(r, f"{CASCADE_SETTINGS.cascade_url}")  # type: ignore
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error="Failed to submit job: " + str(e))

    if submit_job_response.error:
        return submit_job_response

    # Record the job_id and graph specification
    record = {
        "job_id": submit_job_response.job_id,
        "graph_specification": spec.model_dump_json(),
        "status": "submitted",
        "error": None,
        "created_at": datetime.now(),
        "outputs": list(map(lambda x: x.task, sinks)),
    }
    collection = db.get_collection("job_records")
    collection.insert_one(record)

    # submit_response = SubmitResponse(**submit_job_response.model_dump(), output_ids=sinks)
    return submit_job_response
