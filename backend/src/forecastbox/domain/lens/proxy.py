# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Lens proxy -- exposing internally launched lens processes via the backend's own port.

A lens is an external process (e.g. skinnyWMS) that the backend launches and which
binds to 127.0.0.1:<port> on a dynamically chosen port. In containerized deployments
we cannot expose those dynamic ports to the outside world, so instead every lens is
reachable through a fixed path on the backend's own port:

    /api/v1/lens/proxy/<lens_instance_id>/<upstream path>[?<query>]

This module implements a streaming HTTP reverse proxy for that path. The following is
the contract between the backend proxy, the clients that call it, and the lens
processes being proxied. It is authoritative; new clients (beyond the current
frontend, e.g. the CLI) and new lens types must adhere to it.

Supported traffic
------------------
- HTTP/1.1 request/response only, in both directions, fully streamed (no whole-body
  buffering). Request bodies of arbitrary size are streamed upstream; response bodies
  are streamed back downstream. Range requests, conditional requests, and chunked
  responses are supported.
- NOT supported (at the time of writing): WebSocket upgrades, Server-Sent Events kept
  open indefinitely (they will "work" but hold a worker), HTTP/2-only features, and
  any non-HTTP protocol. A lens that a client must reach through this proxy MUST speak
  plain HTTP request/response. See lensExtension-phase3-proxyProtocols-spec.md for how
  these could be added later.

Authentication
--------------
- The proxy route requires an authenticated caller (or passthrough mode). There is
  currently NO per-lens ownership check: any authenticated caller may reach any lens.
  Restricting a lens to the user who started it is a planned extension (a user-lens
  matrix); until then, treat lens contents as visible to all authenticated users.

URL handling -- the client's responsibility
-------------------------------------------
- The lens is mounted under the path prefix /api/v1/lens/proxy/<lens_instance_id>/ .
  The proxy strips that prefix before forwarding: a client request for
  `/api/v1/lens/proxy/<id>/wms?...` reaches the lens as `/wms?...`.
- Clients MUST address the lens using that prefix and MUST treat it as the base
  origin+path of the lens. Because the base has a non-root path, clients that consume
  absolute URLs emitted by the lens (see below) must rebase those URLs onto this
  prefix rather than using them verbatim.
- The proxy sets X-Forwarded-Proto / -Host / -Prefix and a Forwarded header describing
  the external mount point. A forwarded-header-aware lens SHOULD use these to emit
  correct absolute self-URLs. skinnyWMS does not, hence the client-side rebasing
  requirement below.

URL handling -- the lens's responsibility
-----------------------------------------
- A lens SHOULD emit relative URLs, or honour the X-Forwarded-* / Forwarded headers
  (e.g. via a WSGI SCRIPT_NAME / ProxyFix equivalent) when constructing absolute
  self-URLs, so that clients receive URLs already pointing at the proxy path.
- A lens that instead bakes its internal bind address (e.g. http://0.0.0.0:<port>/...)
  into structured, machine-parseable responses (like a WMS GetCapabilities document)
  is tolerable ONLY if clients can and do rebase those URLs onto the proxy prefix. A
  lens that bakes absolute self-origin URLs into opaque payloads that clients cannot
  rewrite is NOT proxyable by this mechanism.
- A lens MUST NOT rely on being reachable on its own port from outside the backend
  host; the only supported ingress is this proxy.

The proxy does NOT rewrite response bodies. Any URL adaptation is the client's job,
per the rules above.
"""

import logging
from collections.abc import AsyncIterator

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.datastructures import Headers

from forecastbox.domain.lens.core import PREFIX as PREFIX_ROOT
from forecastbox.domain.lens.exceptions import UnproxyableLens
from forecastbox.domain.lens.manager import LensInstanceId, get_status

logger = logging.getLogger(__name__)

PREFIX = f"{PREFIX_ROOT}/proxy"

#: Headers that are meaningful only for a single hop and must not be forwarded
#: verbatim in either direction (RFC 7230 section 6.1, plus Content-Length since
#: we let the receiving side recompute framing for a re-streamed body).
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
}

#: Timeout applied to the upstream connection. Generous read timeout because some
#: lens responses (e.g. large tile renders) can take a while to produce.
_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=120.0, pool=5.0)

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Return the module-level `httpx.AsyncClient`, creating it lazily on first use."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


async def aclose_client() -> None:
    """Close the module-level client, if one was created. Intended for use during
    application shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _resolve_port(lens_instance_id: LensInstanceId) -> int:
    """Resolve a lens_instance_id to its bound port.

    Forwards NoLensFound if the instance is unknown, and raises UnproxyableRens if it
    is known but not `running`, or if it has a number of ports other than exactly one
    (an invariant violation for the currently supported lens types).
    """
    detail = get_status(lens_instance_id)
    if detail.status != "running":
        raise UnproxyableLens(f"Lens instance {lens_instance_id!r} is not running (status={detail.status!r})")
    if len(detail.ports) != 1:
        logger.error(f"Lens instance {lens_instance_id!r} does not expose exactly one port: {detail.ports!r}")
        raise UnproxyableLens(f"Lens instance {lens_instance_id!r} does not expose exactly one port")
    return next(iter(detail.ports))  # odd but its a set, we cant just [0] it


def _filtered_headers(headers: httpx.Headers | Headers, *, drop: frozenset[str] = frozenset()) -> list[tuple[str, str]]:
    drop_names = HOP_BY_HOP_HEADERS | drop
    return [(name, value) for name, value in headers.items() if name.lower() not in drop_names]


#: Forwarding headers we (re)generate ourselves. Any inbound copies (set by an
#: outer reverse proxy such as nginx) MUST be dropped before we append fresh ones:
#: appending would leave the upstream with duplicate X-Forwarded-Proto values that
#: disagree (nginx's "https" vs our internal "http"), which gunicorn rejects with
#: "Contradictory scheme headers" (InvalidSchemeHeaders). We fold the inbound chain
#: into our regenerated headers instead (X-Forwarded-For is extended, not dropped).
_FORWARDING_HEADERS = frozenset(
    {
        "x-forwarded-for",
        "x-forwarded-proto",
        "x-forwarded-protocol",
        "x-forwarded-ssl",
        "x-forwarded-host",
        "x-forwarded-prefix",
        "forwarded",
    }
)


def _build_upstream_headers(request: Request, port: int, lens_instance_id: LensInstanceId) -> list[tuple[str, str]]:
    headers = _filtered_headers(request.headers, drop=frozenset({"host"}) | _FORWARDING_HEADERS)

    client_host = request.client.host if request.client is not None else None
    existing_xff = request.headers.get("x-forwarded-for")
    if client_host:
        xff = f"{existing_xff}, {client_host}" if existing_xff else client_host
        headers.append(("X-Forwarded-For", xff))
    elif existing_xff:
        headers.append(("X-Forwarded-For", existing_xff))

    headers.append(("X-Forwarded-Proto", request.url.scheme))
    original_host = request.headers.get("host")
    if original_host:
        headers.append(("X-Forwarded-Host", original_host))
    prefix = f"{PREFIX}/{lens_instance_id}"
    headers.append(("X-Forwarded-Prefix", prefix))

    forwarded_parts = [f"proto={request.url.scheme}"]
    if original_host:
        forwarded_parts.append(f"host={original_host}")
    if client_host:
        forwarded_parts.append(f"for={client_host}")
    headers.append(("Forwarded", ";".join(forwarded_parts)))

    headers.append(("Host", f"127.0.0.1:{port}"))
    return headers


def _has_body(request: Request) -> bool:
    """Does this request carry a body worth streaming upstream?

    Passing a stream for a bodyless GET makes httpx frame it as
    Transfer-Encoding: chunked. gunicorn's sync worker never drains that body,
    so it closes the socket with request data unread, the kernel answers RST,
    and our in-flight response body read dies mid-stream.
    """
    if request.headers.get("transfer-encoding"):
        return True
    try:
        return int(request.headers.get("content-length", "0")) > 0
    except ValueError:
        return False


def _build_upstream_url(port: int, upstream_path: str, query: str) -> str:
    url = f"http://127.0.0.1:{port}/{upstream_path}"
    if query:
        url = f"{url}?{query}"
    return url


async def forward(lens_instance_id: LensInstanceId, upstream_path: str, request: Request) -> StreamingResponse:
    """Forward `request` to the lens identified by `lens_instance_id`, streaming both
    the request body upstream and the response body back downstream.

    Forwards exceptions such as NoLensFound or UnproxyableLens.
    Raises HTTP exceptions in case of upstream connection failure.
    """
    port = _resolve_port(lens_instance_id)

    url = _build_upstream_url(port, upstream_path, request.url.query)
    headers = _build_upstream_headers(request, port, lens_instance_id)
    client = get_client()

    upstream_request = client.build_request(
        request.method,
        url,
        headers=headers,
        **({"content": request.stream()} if _has_body(request) else {}),  # ty:ignore # NOTE ty is for some reason mishandling the kwarg expansion
    )

    # NOTE here we raise HTTP exceptions directly, not domain exceptions -- because we are indeed
    # converting underlying http errors
    try:
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Lens instance {lens_instance_id!r} is unreachable")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Lens instance {lens_instance_id!r} timed out")

    async def body_iterator() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream_response.aiter_raw():
                yield chunk
        finally:
            await upstream_response.aclose()

    response_headers = _filtered_headers(upstream_response.headers)

    return StreamingResponse(
        body_iterator(),
        status_code=upstream_response.status_code,
        headers=dict(response_headers),
    )
