# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the lens reverse proxy."""

import subprocess
from collections.abc import AsyncIterator, Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException, Request
from pyrsistent import pmap

from forecastbox.domain.lens import proxy as lens_proxy
from forecastbox.domain.lens.exceptions import NoLensFound, UnproxyableLens
from forecastbox.domain.lens.manager import LensInstance, LensInstanceId, LensInstanceManager


def _make_request(method: str = "GET", headers: list[tuple[bytes, bytes]] | None = None, query: bytes = b"") -> Request:
    scope = {
        "type": "http",
        "method": method,
        "path": "/api/v1/lens/proxy/some-id/wms",
        "query_string": query,
        "headers": headers or [(b"host", b"example.com")],
        "client": ("10.0.0.5", 12345),
        "scheme": "http",
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def reset_lens_manager() -> Iterator[None]:
    original = LensInstanceManager.instances
    yield
    LensInstanceManager.instances = original


@pytest.fixture(autouse=True)
def reset_proxy_client() -> Iterator[None]:
    yield
    lens_proxy._client = None


class TestResolvePort:
    def test_unknown_instance_raises_no_lens_found(self) -> None:
        LensInstanceManager.instances = pmap()
        with pytest.raises(NoLensFound):
            lens_proxy._resolve_port(LensInstanceId("ghost"))

    def test_not_running_instance_raises_unproxyable(self) -> None:
        iid = LensInstanceId("starting-id")
        LensInstanceManager.instances = pmap({iid: LensInstance(process=None, lens_params={}, lens_name="skinnyWMS", ports={19000})})
        with pytest.raises(UnproxyableLens):
            lens_proxy._resolve_port(iid)

    def test_running_instance_returns_sole_port(self) -> None:
        iid = LensInstanceId("running-id")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        LensInstanceManager.instances = pmap({iid: LensInstance(process=mock_proc, lens_params={}, lens_name="skinnyWMS", ports={19042})})
        assert lens_proxy._resolve_port(iid) == 19042

    def test_multiple_ports_raises_unproxyable(self) -> None:
        iid = LensInstanceId("multi-port-id")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        LensInstanceManager.instances = pmap(
            {iid: LensInstance(process=mock_proc, lens_params={}, lens_name="skinnyWMS", ports={19042, 19043})}
        )
        with pytest.raises(UnproxyableLens):
            lens_proxy._resolve_port(iid)


class TestBuildUpstreamUrl:
    def test_without_query(self) -> None:
        assert lens_proxy._build_upstream_url(19042, "wms", "") == "http://127.0.0.1:19042/wms"

    def test_with_query(self) -> None:
        url = lens_proxy._build_upstream_url(19042, "wms", "service=WMS&request=GetCapabilities")
        assert url == "http://127.0.0.1:19042/wms?service=WMS&request=GetCapabilities"


class TestBuildUpstreamHeaders:
    def test_sets_forwarding_headers(self) -> None:
        request = _make_request()
        headers = dict(lens_proxy._build_upstream_headers(request, 19042, LensInstanceId("id-1")))
        assert headers["X-Forwarded-For"] == "10.0.0.5"
        assert headers["X-Forwarded-Proto"] == "http"
        assert headers["X-Forwarded-Host"] == "example.com"
        assert headers["X-Forwarded-Prefix"] == "/api/v1/lens/proxy/id-1"
        assert headers["Host"] == "127.0.0.1:19042"
        assert "for=10.0.0.5" in headers["Forwarded"]

    def test_drops_hop_by_hop_and_host(self) -> None:
        request = _make_request(headers=[(b"host", b"example.com"), (b"connection", b"keep-alive")])
        headers = lens_proxy._build_upstream_headers(request, 19042, LensInstanceId("id-1"))
        names = {name.lower() for name, _ in headers}
        assert "connection" not in names


class TestForward:
    @pytest.mark.asyncio
    async def test_unknown_instance_raises_no_lens_found(self) -> None:
        LensInstanceManager.instances = pmap()
        request = _make_request()
        with pytest.raises(NoLensFound):
            await lens_proxy.forward(LensInstanceId("ghost"), "wms", request)

    @pytest.mark.asyncio
    async def test_not_running_instance_raises_unproxyable(self) -> None:
        iid = LensInstanceId("starting-id")
        LensInstanceManager.instances = pmap({iid: LensInstance(process=None, lens_params={}, lens_name="skinnyWMS", ports={19000})})
        request = _make_request()
        with pytest.raises(UnproxyableLens):
            await lens_proxy.forward(iid, "wms", request)

    @pytest.mark.asyncio
    async def test_connect_error_yields_502(self) -> None:
        iid = LensInstanceId("running-id")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        LensInstanceManager.instances = pmap({iid: LensInstance(process=mock_proc, lens_params={}, lens_name="skinnyWMS", ports={19042})})
        request = _make_request()
        with patch.object(httpx.AsyncClient, "send", AsyncMock(side_effect=httpx.ConnectError("refused"))):
            with pytest.raises(HTTPException) as exc_info:
                await lens_proxy.forward(iid, "wms", request)
        assert exc_info.value.status_code == 502

    @pytest.mark.asyncio
    async def test_success_streams_response(self) -> None:
        iid = LensInstanceId("running-id")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        LensInstanceManager.instances = pmap({iid: LensInstance(process=mock_proc, lens_params={}, lens_name="skinnyWMS", ports={19042})})
        request = _make_request()

        async def fake_aiter_raw() -> AsyncIterator[bytes]:
            yield b"hello "
            yield b"world"

        upstream_response = AsyncMock()
        upstream_response.status_code = 200
        upstream_response.headers = httpx.Headers({"content-type": "text/plain"})
        upstream_response.aiter_raw = fake_aiter_raw
        upstream_response.aclose = AsyncMock()

        with patch.object(httpx.AsyncClient, "send", AsyncMock(return_value=upstream_response)):
            response = await lens_proxy.forward(iid, "wms", request)

        assert response.status_code == 200
        chunks: list[bytes] = [chunk async for chunk in response.body_iterator]  # type: ignore[misc]
        assert b"".join(chunks) == b"hello world"
        upstream_response.aclose.assert_awaited_once()


class TestUpstreamRequestFraming:
    """A bodyless GET must not be framed as chunked upstream.

    gunicorn's sync worker never drains a request body on a GET: it answers and
    closes the socket with that body unread, the kernel sends RST rather than a
    clean FIN, and the response we are still streaming back is truncated.
    """

    @staticmethod
    def _running(iid: LensInstanceId) -> None:
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        LensInstanceManager.instances = pmap({iid: LensInstance(process=mock_proc, lens_params={}, lens_name="skinnyWMS", ports={19042})})

    @staticmethod
    def _upstream() -> AsyncMock:
        async def fake_aiter_raw() -> AsyncIterator[bytes]:
            yield b"ok"

        response = AsyncMock()
        response.status_code = 200
        response.headers = httpx.Headers({"content-type": "image/png"})
        response.aiter_raw = fake_aiter_raw
        response.aclose = AsyncMock()
        return response

    @pytest.mark.asyncio
    async def test_bodyless_get_is_not_chunked(self) -> None:
        iid = LensInstanceId("running-id")
        self._running(iid)
        send = AsyncMock(return_value=self._upstream())
        with patch.object(httpx.AsyncClient, "send", send):
            await lens_proxy.forward(iid, "wms", _make_request())
        sent = send.await_args.args[0]
        assert "transfer-encoding" not in {name.lower() for name in sent.headers}

    @pytest.mark.asyncio
    async def test_request_with_a_body_is_still_streamed(self) -> None:
        iid = LensInstanceId("running-id")
        self._running(iid)
        request = _make_request("POST", headers=[(b"host", b"example.com"), (b"content-length", b"12")])
        send = AsyncMock(return_value=self._upstream())
        with patch.object(httpx.AsyncClient, "send", send):
            await lens_proxy.forward(iid, "wms", request)
        sent = send.await_args.args[0]
        assert sent.headers.get("transfer-encoding") == "chunked"
