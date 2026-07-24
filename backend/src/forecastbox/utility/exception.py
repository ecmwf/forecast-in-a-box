# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""FastAPI exception registration for utility-owned exceptions."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from forecastbox.utility.concurrency.manager import SubmissionRejected


def register_handlers(app: FastAPI) -> None:
    """Register application-level handlers for utility-owned exceptions."""

    @app.exception_handler(SubmissionRejected)
    async def _handle_submission_rejected(request: Request, exc: SubmissionRejected) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=503,
            content={"detail": f"Service busy ({exc}). Please retry shortly."},
        )
