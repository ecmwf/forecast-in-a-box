"""Products API Router."""

from datetime import datetime
from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

import tempfile

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from .models import get_model_path
from ..types import GraphSpecification

from earthkit.workflows import Cascade, fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes

from cascade.low.into import graph2job
from cascade.low import views as cascade_views

from cascade.low.core import JobInstance, DatasetId
from cascade.controller.report import JobId, JobProgress

import cascade.gateway.api as api
import cascade.gateway.client as client

from ..database import db

from forecastbox.settings import APISettings, CascadeSettings
from forecastbox.api.types import VisualisationOptions

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
    model = Model(get_model_path(spec.model.model), **model_spec)
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



@router.post("/visualise", response_model=str)
async def get_graph_visualise(spec: GraphSpecification, options: VisualisationOptions = VisualisationOptions()) -> HTMLResponse:
    """Get an HTML visualisation of the product graph."""
    try:
        graph = await convert_to_cascade(spec)
    except Exception as e:
        return HTMLResponse(str(e), status_code=500)

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, **options.model_dump())

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
    # try:
    #     return await execute(spec)
    # except Exception as e:
    #     return HTMLResponse(str(e), status_code=500)

async def execute(spec: GraphSpecification) -> api.SubmitJobResponse:
    """Get serialised dump of product graph."""
    try:
        graph = await convert_to_cascade(spec)
    except Exception as e:
        return api.SubmitJobResponse(job_id = None, error=str(e))
    
    model_path = get_model_path(spec.model.model)

    job = graph2job(graph._graph)

    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]

    job.ext_outputs = sinks

    BLACKLISTED_INSTALLS = ['anemoi', 'anemoi-training', 'anemoi-inference', 'anemoi-utils']
    env = [f"{key}=={val}" for key, val in Model.versions(model_path).items() if key not in BLACKLISTED_INSTALLS]
    env.extend(['anemoi-inference', 'anemoi-cascade'])

    # Manual GPU allocation
    for task_id, task in job.tasks.items():
        if task_id.startswith("run_as_earthkit"):
            task.definition.needs_gpu = True
        # Set the environment variables for the job
        if any([lambda x: x in task_id, ["run_as_earthkit", "get_initial_conditions"]]):
            # task.definition.environment = env
            pass

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
        "error": None,
        "created_at": datetime.now(),
        "outputs": list(map(lambda x: x.task, sinks)),
    }
    collection = db.get_collection("job_records")
    collection.insert_one(record)

    # submit_response = SubmitResponse(**submit_job_response.model_dump(), output_ids=sinks)
    return submit_job_response
