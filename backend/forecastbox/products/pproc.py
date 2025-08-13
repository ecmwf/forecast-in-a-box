# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from abc import abstractmethod
from pathlib import Path
from typing import Any

from earthkit.workflows import fluent
from earthkit.workflows.graph import Graph, deduplicate_nodes
from earthkit.workflows.plugins.anemoi.types import ENSEMBLE_DIMENSION_NAME
from earthkit.workflows.plugins.pproc.fluent import Action as ppAction
from earthkit.workflows.plugins.pproc.templates import derive_template
from forecastbox.config import config
from forecastbox.models import SpecifiedModel
from forecastbox.products.product import Product

from .export import export_fieldlist_as


def from_request(
    request: dict, pproc_schema: str, action_kwargs: dict[str, Any] | None = None, **sources: fluent.Action
) -> fluent.Action:
    inputs = []
    for source in sources.values():
        inputs.append({k: list(source.nodes.coords[k].values) for k in source.nodes.coords.keys()})

    config = derive_template(request, pproc_schema)
    return config.action(**(action_kwargs or {}), **sources)


class PProcProduct(Product):
    """Base Product Class for use of PPROC"""

    @abstractmethod
    def mars_request(self, product_spec: dict[str, Any]) -> dict[str, Any] | list[dict[str, Any]]:
        """Get the Mars request for the product.

        Must be recognized by pproc.
        """
        pass

    @property
    def default_request_keys(self) -> dict[str, Any]:
        return {
            "expver": "0001",
        }

    @property
    def action_kwargs(self) -> dict[str, Any]:
        return {"ensemble_dim": ENSEMBLE_DIMENSION_NAME}

    def get_sources(
        self, product_spec: dict[str, Any], model: SpecifiedModel, source: fluent.Action
    ) -> dict[str, fluent.Action]:
        """Get sources for pproc action.

        By default just provides the model source as 'forecast'

        If different sources are needed, this method should be overridden.
        Use, 'model.deaccumulate(source)' to deaccumulate the source if needed.

        Parameters
        ----------
        product_spec : dict[str, Any]
            Product specification
        model : Model
            Model object
        source : fluent.Action
            Model source action

        Returns
        -------
        dict[str, fluent.Action]
            Dictionary of sources for pproc action
        """
        return {"forecast": source}

    @property
    def _pproc_schema_path(self) -> str:
        """Get the path to the PPROC schema."""
        fallback_path = Path(__file__).parent / "schema" / "default.yaml"
        if config.general.pproc_schema_dir is None:
            return str(fallback_path)

        class_name = self.__class__.__name__
        schema_dir = Path(config.general.pproc_schema_dir)
        schema_path = Path(schema_dir) / f"{str(class_name).lower()}.yaml"

        if not schema_path.exists():
            if (schema_dir / "default.yaml").exists():
                return str(schema_dir / "default.yaml")
            return str(fallback_path)
        return str(schema_path)

    def request_to_graph(self, request: dict[str, Any] | list[dict[str, Any]], **sources: fluent.Action) -> Graph:
        """Convert a request to a graph action.

        Parameters
        ----------
        request : dict[str, Any] | list[dict[str, Any]]
            Mars requests to use with pproc
        sources : fluent.Action
            Actions to use with pproc-cascade as sources

        Returns
        -------
        Graph
            PPROC graph
        """
        total_graph = Graph([])
        if not isinstance(request, list):
            request = [request]

        for key in sources:
            sources[key] = ppAction(sources[key].nodes)

        for req in request:
            total_graph += (
                from_request(req, self._pproc_schema_path, self.action_kwargs, **sources)
                .map(export_fieldlist_as(format="grib"))
                .map(self.named_payload(self.__class__.__name__))
                .graph()
            )

        return deduplicate_nodes(total_graph)

    def execute(self, product_spec: dict[str, Any], model: SpecifiedModel, source: fluent.Action):
        """Convert the product specification to a graph action."""
        request = self.mars_request(product_spec).copy()

        if not isinstance(request, list):
            request = [request]

        full_requests = []
        for req in request:
            req_full = {
                "date": model.specification['date'],
                "time": model.specification.get('time', '00'),
                "domain": getattr(model, "domain", "g"),
                **self.default_request_keys,
            }
            req_full.update(req)
            full_requests.append(req_full)

        sources = self.get_sources(product_spec, model, source)
        return self.request_to_graph(full_requests, **sources)
