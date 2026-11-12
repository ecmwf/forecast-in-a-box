# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from pathlib import Path

import httpx
import pytest
from starlette.applications import Starlette
from starlette.routing import Mount

from forecastbox.entrypoint.spa import SPAStaticFiles

INDEX = "<html>index</html>"


def _client(directory: Path) -> httpx.AsyncClient:
    (directory / "index.html").write_text(INDEX)
    (directory / "assets").mkdir()
    (directory / "assets" / "index-abc123.js").write_text("console.log(1)")
    app = Starlette(routes=[Mount("/", SPAStaticFiles(directory=directory, html=True), name="static")])
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["/", "/overview", "/runs/abc", "/index.html"])
async def test_index_is_no_cache(tmp_path: Path, url: str) -> None:
    async with _client(tmp_path) as client:
        response = await client.get(url)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_index_revalidation_is_no_cache(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        etag = (await client.get("/")).headers["etag"]
        response = await client.get("/", headers={"If-None-Match": etag})
    assert response.status_code == 304
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_hashed_asset_is_immutable(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        response = await client.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["/assets/index-gone.js", "/gone.css"])
async def test_missing_asset_stays_404(tmp_path: Path, url: str) -> None:
    async with _client(tmp_path) as client:
        response = await client.get(url)
    assert response.status_code == 404
