# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Building jobs -- provide components for high level graph building and configuring,
validate/extend partial graphs, compile graphs into jobs."""

from fastapi import APIRouter

from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.graph_building import ActionFactoryCatalog, GraphValidationExpansion, GraphBuilder
import forecastbox.api.graph_building as example

router = APIRouter(
    tags=["build"],
    responses={404: {"description": "Not found"}},
)


# Endpoints
@router.get("/catalog")
def get_catalog() -> ActionFactoryCatalog:
    """All actions this backend is capable of evaluating within a graph"""
    return example.catalog


@router.get("/expand")
def expand_graph(graph: GraphBuilder) -> GraphValidationExpansion:
    """Given a partially constructed graph, return whether there are any validation errors,
    and what are further completion/expansion options. Note that presence of validation
    errors does not affect return code, ie its still 200 OK"""
    return example.validate_expand(graph)


@router.get("/compile")
def compile_graph(graph: GraphBuilder) -> RawCascadeJob:
    """Converts to a raw cascade job, which can then be used in a ExecutionSpecification
    in the /execution router's methods. Assumes the graph is valid, and throws a 4xx
    otherwise"""
    return example.compile(graph)
