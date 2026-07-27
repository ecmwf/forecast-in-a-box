# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Generic FastAPI exception handling for cross-domain utility exceptions.

Several utility modules (`forecastbox.utility.concurrency.manager`,
`forecastbox.utility.concurrency.ports`) define exception classes that can be
raised from almost any route, since they originate from shared infrastructure
(bounded execution pools, the ports allocator) rather than from a specific
domain. Domain-specific exceptions are translated to HTTP responses at each
route, but these cross-cutting exceptions would otherwise surface to callers
as unhandled 500s with a raw traceback.

`register_common_exception_handling` installs FastAPI exception handlers for
these exceptions so that they consistently produce a 503 response, in the
spirit of "some internal resource is momentarily exhausted, try again later".
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from forecastbox.utility.concurrency.manager import ExecutionManagerError
from forecastbox.utility.concurrency.ports import NoFreePortsException

logger = logging.getLogger(__name__)

_RETRY_LATER_DETAIL = "The server is temporarily out of capacity for this request. Please try again later."


async def _handle_resource_starvation(request: Request, exc: Exception) -> JSONResponse:
    logger.warning(f"resource starvation on {request.url.path!r}: {exc!r}")
    return JSONResponse(status_code=503, content={"detail": _RETRY_LATER_DETAIL})


def register_common_exception_handling(app: FastAPI) -> None:
    """Register handlers for cross-domain utility exceptions.

    `ExecutionManagerError` and `NoFreePortsException` (and, since Starlette
    resolves handlers by walking the exception's MRO, all of their subclasses)
    are mapped to a 503 response rather than an unhandled 500.
    """
    app.add_exception_handler(ExecutionManagerError, _handle_resource_starvation)
    app.add_exception_handler(NoFreePortsException, _handle_resource_starvation)
