# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Execution API Router."""

import asyncio
import logging

from cascade.low.core import JobInstance
from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from forecastbox.api.execution import SubmitJobResponse
from forecastbox.api.execution import execute
from forecastbox.api.execution import execution_specification_to_cascade
from forecastbox.api.types import ExecutionSpecification
from forecastbox.api.types import VisualisationOptions
from forecastbox.api.visualisation import visualise
from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import UserRead

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)

LOG = logging.getLogger(__name__)


@router.post("/visualise")
async def get_graph_visualise(spec: ExecutionSpecification, options: VisualisationOptions = None) -> HTMLResponse:
    """Get an HTML visualisation of the product graph.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    options : VisualisationOptions, optional
        Visualisation options, by default None

    Returns
    -------
    HTMLResponse
        An HTML response containing the visualisation of the product graph.
    """
    if options is None:
        options = VisualisationOptions()

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, visualise, spec, options)  # CPU bound


@router.post("/serialise")
async def get_graph_serialised(spec: ExecutionSpecification) -> JobInstance:
    """Get serialised dump of product graph.

    Contains the job instance as `Cascade` creates it.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.

    Returns
    -------
    JobInstance
        Instance of the job created from the product graph.

    Raises
    ------
    HTTPException
        If there is an error serialising the graph, a 500 error is raised with the error message.
    """
    try:
        return execution_specification_to_cascade(spec)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error serialising graph: {e}",
        )


@router.post("/download")
async def get_graph_download(spec: ExecutionSpecification) -> str:
    """Get downloadable json of the graph.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.

    Returns
    -------
    str
        A JSON string representing the execution specification of the product graph.
    """
    return spec.model_dump_json()


@router.post("/execute")
async def execute_api(
    spec: ExecutionSpecification, user: UserRead | None = Depends(current_active_user)
) -> SubmitJobResponse:
    """Execute a job based on the provided execution specification.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    user : UserRead, optional
        User object, by default Depends(current_active_user)

    Returns
    -------
    SubmitJobResponse
        Job submission response containing the job ID.
    """
    return await execute(spec, user=user)
