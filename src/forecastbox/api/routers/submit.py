"""Products API Router."""

from fastapi import APIRouter, Response

import os
from pathlib import Path

from forecastbox.products.registry import get_categories, get_product, Category
from forecastbox.models import Model

from ..models import open_checkpoint
from ..types import SubmitSpecification

from cascade import Cascade
from cascade.fluent import Action

import tempfile

router = APIRouter(
	tags=["submit"],
	responses={404: {"description": "Not found"}},
)

class FileRegister:
    def __init__(self):
        self.files = []

    def add(self, file):
        self.files.append(file)

    def clear(self):
        for file in self.files:
            file.close()

    def __del__(self):
        self.clear()

GRAPHS = FileRegister()

async def convert_to_cascade(spec: SubmitSpecification) -> Cascade:
    """Convert a specification to a cascade."""

    ckpt = await open_checkpoint(spec.model.model)
    model_action = Model(ckpt).graph(None, spec.model.lead_time, date = spec.model.date, ensemble_members = spec.model.ensemble_members, **spec.model.entries)
    
    product_cascade = Cascade()

    for product in spec.products:
        product_action = get_product(*product.product.split('/', 1)).to_graph(product.specification, model_action)
        product_cascade += Cascade(product_action.graph())

    if len(spec.products) == 0:
        product_cascade += Cascade(model_action.graph())

    return product_cascade


@router.post("/visualise", response_model=str)
async def get_graph_visualise(spec: SubmitSpecification):
    """Submit a full configuration."""
    graph = await convert_to_cascade(spec)

    graph_dir = os.environ.get('FIAB_GRAPH_DIR', tempfile.gettempdir())

    dest = tempfile.NamedTemporaryFile(suffix=".html", dir = graph_dir)
    GRAPHS.add(dest)
    visualised = graph.visualise(dest.name, preset = 'blob')
    assert visualised is not None
    parent_path = str(Path(graph_dir).absolute().resolve()).replace(graph_dir.removesuffix('/'), '')
    return Response(str(Path(dest.name).relative_to(parent_path)), media_type="text")




@router.post("/serialise", response_model=bytes)
async def get_graph_serialised(spec: SubmitSpecification):
    """Submit a full configuration."""
    graph = await convert_to_cascade(spec)

    from cascade.graph.export import serialise
    from cascade.graph.deduplicate import deduplicate_nodes
    import dill
    graph_bytes = dill.dumps(serialise(deduplicate_nodes(graph._graph)))
    return Response(graph_bytes, media_type="application/octet-stream")
