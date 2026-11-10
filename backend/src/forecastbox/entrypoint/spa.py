# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Static file serving of the bundled single-page frontend"""

import os
from typing import Any

from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException


class SPAStaticFiles(StaticFiles):
    """Custom StaticFiles class to handle SPA routing.

    - Asset-shaped paths (anything with a file extension or under /assets/)
      that 404 stay 404, so the browser surfaces a useful "chunk failed
    - SPA routes (no extension) fall through to index.html.
    - Cache-Control headers: hashed assets are cached forever; index.html is
      `no-cache` whether served for the root, an SPA route or by name.
    """

    async def get_response(self, path: str, scope: Any) -> Response:
        # Starlette normalises the root path to "."
        serves_index = path == "." or path.endswith(".html")
        try:
            response = await super().get_response(path, scope)
        except HTTPException as ex:
            if ex.status_code == 404:
                last_segment = path.rsplit("/", 1)[-1]
                if path.startswith("assets/") or "." in last_segment:
                    raise  # genuine asset miss -- let the 404 propagate
                response = FileResponse(os.path.join(str(self.directory), "index.html"))
                serves_index = True
            else:
                raise

        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif serves_index:
            response.headers["Cache-Control"] = "no-cache"
        return response
