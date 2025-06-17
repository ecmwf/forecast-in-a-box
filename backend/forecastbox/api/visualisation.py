# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from forecastbox.api.types import VisualisationOptions, ExecutionSpecification, ForecastProducts
from fastapi.responses import HTMLResponse
import tempfile
from forecastbox.api.execution import forecast_products_to_cascade

logger = logging.getLogger(__name__)


def visualise(spec: ExecutionSpecification, options: VisualisationOptions) -> HTMLResponse:
    if not isinstance(spec.job, ForecastProducts):
        return HTMLResponse("Visualisation supported only for ForecastProducts", status_code=400)

    try:
        graph = forecast_products_to_cascade(spec.job, spec.environment)
    except Exception as e:
        logger.exception("Error converting to cascade")
        return HTMLResponse(str(e), status_code=500)

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, **options.model_dump())

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")
