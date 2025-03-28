"""Products API Router."""

from fastapi import APIRouter, Response


from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from .models import get_model_path
from ..types import GraphSpecification

from cascade import Cascade
from cascade.low.into import graph2job
from cascade.low.core import JobInstance

import tempfile
from forecastbox.settings import get_settings

router = APIRouter(
	tags=["graph"],
	responses={404: {"description": "Not found"}},
)

SETTINGS = get_settings()

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
async def get_graph_visualise(spec: GraphSpecification):
    """Get an HTML visualisation of the product graph."""
    graph = await convert_to_cascade(spec)
    
    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, preset = 'blob')

        with open(dest.name, 'r') as f:
            return Response(f.read(), media_type="text/html")

@router.post("/serialise")
async def get_graph_serialised(spec: GraphSpecification) -> JobInstance:
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    return graph2job(graph._graph)

@router.post("/execute")
async def execute(spec: GraphSpecification):
    """Get serialised dump of product graph."""
    graph = await convert_to_cascade(spec)
    job =  graph2job(graph._graph)

    import cascade.gateway.api as api
    import cascade.gateway.client as client
    import os
    os.environ["GENERATORS_N"] = "8"
    os.environ["GENERATORS_K"] = "10"
    os.environ["GENERATORS_L"] = "4"

    r = api.SubmitJobRequest(job=api.JobSpec(benchmark_name=None, workers_per_host=2, hosts=2, envvars={}, use_slurm=False, job_instance=job))
    return client.request_response(r, f"tcp://{SETTINGS.cascade_gateway}")
