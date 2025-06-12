# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Execution API Router."""

from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse

import logging

from pydantic import BaseModel

from cascade.low.core import JobInstance

from forecastbox.db import db
from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import UserRead

from forecastbox.api.types import VisualisationOptions, ExecutionSpecification
from forecastbox.api.visualisation import visualise
from forecastbox.api.execution import execution_specification_to_cascade
from forecastbox.api.execution import execute as execute_specification

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)

LOG = logging.getLogger(__name__)


class SubmitJobResponse(BaseModel):
    """Submit Job Response."""

    id: str
    """Id of the submitted job."""


@router.post("/visualise")
async def get_graph_visualise(spec: ExecutionSpecification, options: VisualisationOptions = None) -> HTMLResponse:
    """
    Get an HTML visualisation of the product graph.

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

    return visualise(spec, options)


@router.post("/serialise")
async def get_graph_serialised(spec: ExecutionSpecification) -> JobInstance:
    """
    Get serialised dump of product graph.

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
    """
    Get downloadable json of the graph.

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


async def execute(spec: ExecutionSpecification, user: UserRead, background_tasks: BackgroundTasks) -> SubmitJobResponse:
    """
    Execute a job based on the provided execution specification.

    Immediately submits the job to the database and starts the execution in the background.


    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    user : UserRead
        User object representing the user executing the job.
    background_tasks : BackgroundTasks
        fastapi BackgroundTasks instance to handle background execution.

    Returns
    -------
    SubmitJobResponse
        Job submission response containing the job ID.
    """
    import uuid

    id = str(uuid.uuid4())
    collection = db.get_collection("job_records")
    collection.insert_one(
        {
            "id": id,
            "status": "submitting",
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
            "graph_specification": spec.model_dump_json(),
        }
    )

    background_tasks.add_task(execute_specification, spec, id, user)
    return SubmitJobResponse(id=id)


@router.post("/execute")
async def execute_api(
    spec: ExecutionSpecification, background_tasks: BackgroundTasks, user: UserRead = Depends(current_active_user)
) -> SubmitJobResponse:
    """
    Execute a job based on the provided execution specification.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    background_tasks : BackgroundTasks
        fastapi BackgroundTasks instance to handle background execution.
    user : UserRead, optional
        User object, by default Depends(current_active_user)

    Returns
    -------
    SubmitJobResponse
        Job submission response containing the job ID.
    """
    response = await execute(spec, user=user, background_tasks=background_tasks)
    return response
