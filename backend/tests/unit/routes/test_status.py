# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from starlette.requests import Request

from forecastbox.routes import status as status_route
from forecastbox.utility.http_pools import HttpProfile


class FakeAsyncClient:
    def __init__(self, result: httpx.Response | httpx.HTTPError) -> None:
        self.result = result
        self.url: str | None = None
        self.timeout: float | None = None

    async def get(self, url: str, *, timeout: float) -> httpx.Response:
        self.url = url
        self.timeout = timeout
        if isinstance(self.result, httpx.HTTPError):
            raise self.result
        return self.result


async def _get_status(monkeypatch: pytest.MonkeyPatch, fake_client: FakeAsyncClient) -> status_route.StatusResponse:
    monkeypatch.setattr(status_route, "client", SimpleNamespace(request_response=Mock()))
    monkeypatch.setattr(status_route, "get_gateway_url", lambda: "http://gateway")
    monkeypatch.setattr(status_route, "status_scheduler", lambda: "ok")
    monkeypatch.setattr(status_route, "status_brief", lambda: "ok")

    def get_async(profile: HttpProfile) -> FakeAsyncClient:
        assert profile is HttpProfile.Default
        return fake_client

    monkeypatch.setattr(status_route, "get_async", get_async)
    request = Request({"type": "http", "app": SimpleNamespace(version="test")})
    return await status_route.get_status(request)


@pytest.mark.asyncio
@pytest.mark.parametrize(("status_code", "expected"), [(200, "up"), (503, "down")])
async def test_status_checks_external_model_repository(monkeypatch: pytest.MonkeyPatch, status_code: int, expected: str) -> None:
    fake_client = FakeAsyncClient(httpx.Response(status_code))

    response = await _get_status(monkeypatch, fake_client)

    assert response.ecmwf == expected
    assert fake_client.url == f"{status_route.config.external.model_repository}/MANIFEST"
    assert fake_client.timeout == 5


@pytest.mark.asyncio
async def test_status_reports_external_repository_http_error_as_down(monkeypatch: pytest.MonkeyPatch) -> None:
    request = httpx.Request("GET", "https://example.com/MANIFEST")
    fake_client = FakeAsyncClient(httpx.ConnectError("offline", request=request))

    response = await _get_status(monkeypatch, fake_client)

    assert response.ecmwf == "down"
