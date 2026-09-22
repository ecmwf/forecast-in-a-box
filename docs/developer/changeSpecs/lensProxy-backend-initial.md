# Lens Proxy -- Backend Initial Implementation

## Context

Lenses are external processes (currently only skinnyWMS) launched by the backend via
`domain/lens/manager.py`. Each instance binds `gunicorn` to `127.0.0.1:<port>` where
`<port>` is claimed from `FreePortsManager` (pool 19000-19100). The instance detail
(`LensInstanceDetail`) currently exposes the raw `ports` set, and the frontend talks
to the lens **directly** on that port, cross-origin (hence skinnyWMS is launched with
`SKINNYWMS_CORS_ORIGINS=*`).

This works only when the browser can reach the backend host's dynamic ports -- i.e.
local / single-host deployments. In a container (docker on k8s) we want a **static set
of exposed ports**. Therefore we want the lens to be reachable through a path on the
backend's own port: `GET/POST/... /api/v1/lens/proxy/<lens_id>/<upstream path>`.

## Goal of this task

Implement a reverse-proxy route on the backend that:

1. Accepts requests at `/api/v1/lens/proxy/{lens_instance_id}/{path:path}` for all
   relevant HTTP methods.
2. Validates that `lens_instance_id` refers to a known, `running` lens instance
   (404 otherwise).
3. Performs **basic** auth: the caller must be an authenticated user (or passthrough).
   Do **not** implement per-user ownership of lenses in this task -- see below.
4. Forwards the request to `127.0.0.1:<port>/<path>` (preserving query string) and
   **streams** both the request body upstream and the response body back downstream,
   using `httpx` (already a dependency).
5. Sets the standard forwarding headers (`X-Forwarded-*`, `Forwarded`) even though
   skinnyWMS does not currently honour them -- they are part of the published contract
   and future lenses / a future body-rewriting layer may rely on them.

This is a **breaking switch**: after this task, lenses are reachable **only** via the
proxy route. No config flag, no backwards-compatible dual mode. The frontend change
(see `lensProxy-frontend.md`) ships in the same pull request.

## Non-goals (explicit)

- **Granular auth (user-lens matrix).** We will eventually track which user started
  which lens and restrict proxy access accordingly. That is *not* part of this task.
  The implementer must leave a marker in the code where that check would go:

  ```python
  # TODO implement granual auth: user-lens matrix
  ```

- WebSocket / SSE / arbitrary TCP forwarding -- HTTP request/response streaming only.
  (See `lensProxy-backend-extension.md`.)
- Offloading proxy traffic off the single uvicorn worker -- accepted as a known
  concern for now. (See `lensProxy-backend-sidecar.md`.)

## Where the code goes

Create a new module `backend/src/forecastbox/domain/lens/proxy.py`. As much of the
logic as possible lives here (the forwarding engine, header construction, upstream URL
building, instance validation helper). The route in `routes/lens.py` should be a thin
wrapper that wires FastAPI's `Request`/`StreamingResponse` and the auth dependency to
the domain function.

`proxy.py` must open with a **module-level docstring containing the client/lens
contract** reproduced verbatim below (see "Contract docstring"). This docstring is the
single source of truth for what any client (today the frontend, tomorrow the `cli/`)
and any lens instance must abide by. It is placed here deliberately so that, when we
add more clients, the contract is discoverable next to the implementation.

## Implementation notes

### Route

In `routes/lens.py`, add something like:

```python
from fastapi import Request
from fastapi.responses import StreamingResponse
from forecastbox.domain.lens import proxy as lens_proxy

@router.api_route(
    "/proxy/{lens_instance_id}/{upstream_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_lens(
    lens_instance_id: LensInstanceId,
    upstream_path: str,
    request: Request,
    auth_context: AuthContext = Depends(get_auth_context),
) -> StreamingResponse:
    # TODO implement granual auth: user-lens matrix
    # (auth_context is currently only used to require an authenticated caller;
    #  once the user-lens matrix exists, check ownership here.)
    return await lens_proxy.forward(lens_instance_id, upstream_path, request)
```

Notes:
- The `Depends(get_auth_context)` dependency already enforces "authenticated or
  passthrough" (see `domain/auth/users.py::get_auth_context`, which raises in
  non-passthrough deployments when unauthenticated). That satisfies "basic auth".
- Keep `auth_context` in the signature even though its fields are unused for now, so
  the auth is actually enforced and the granular-auth TODO has an obvious home.

### Instance resolution

Add a helper in `manager.py` (or `proxy.py` reaching into the manager) that resolves a
`lens_instance_id` to its bound port, raising `KeyError` when the id is unknown and a
distinct error when the instance exists but is not `running` (so the route can map to
404 vs 409/503 as appropriate). Reuse `get_status` / the `instances` map. A lens has a
`ports: set[int]`; skinnyWMS uses exactly one. For this task assume a single HTTP port
(take the sole element; if the set is not a singleton, that's a 500-worthy invariant
violation -- log and raise).

### Forwarding engine (in `proxy.py`)

- Use a module-level `httpx.AsyncClient` (lazily created / lifespan-managed) with a
  reasonable timeout. Target base URL `http://127.0.0.1:<port>`.
- Build the upstream URL: `f"http://127.0.0.1:{port}/{upstream_path}"` plus
  `request.url.query`.
- Stream the request body with `request.stream()` into `client.stream(...)` so large
  uploads are not buffered.
- Stream the response back with `StreamingResponse(resp.aiter_raw(), ...)`, propagating
  the upstream `status_code`, and copying response headers **minus hop-by-hop headers**
  (`Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`,
  `Trailer`, `Transfer-Encoding`, `Upgrade`, and `Content-Length` if you re-stream
  chunked -- let Starlette recompute framing). Also forward `Content-Type`,
  `Cache-Control`, `Content-Range`, `Accept-Ranges` etc. as-is.
- Forward the incoming request headers upstream **minus** hop-by-hop headers and
  `Host` (set `Host` to `127.0.0.1:<port>` or let httpx set it). Preserve `Range`,
  `If-*`, `Accept*`, cookies.
- Set forwarding headers on the upstream request:
  - `X-Forwarded-For`: append `request.client.host` to any existing value.
  - `X-Forwarded-Proto`: `request.url.scheme`.
  - `X-Forwarded-Host`: the original `Host` header.
  - `X-Forwarded-Prefix`: `/api/v1/lens/proxy/{lens_instance_id}` (the path segment
    the upstream is mounted under -- lets a forwarded-aware lens emit correct absolute
    URLs; skinnyWMS ignores it today).
  - Equivalent `Forwarded:` header (RFC 7239) may also be set.
- Ensure the `httpx` streaming response is properly closed when the client
  disconnects (use `StreamingResponse` with a `background`/`aclose` hook, or the
  `client.stream` context managed within the generator). Handle
  `httpx.ConnectError` / connection-refused (lens died) as 502/503.

### Optional: tighten skinnyWMS CORS

Because traffic is now same-origin (browser -> backend origin -> loopback), the lens no
longer needs `SKINNYWMS_CORS_ORIGINS=*`. You *may* remove or restrict that env in
`manager.start_skinny_wms` (e.g. drop it, or set it to the loopback origin). This is a
minor hardening; **skip it if it turns out to break skinnyWMS boot or the request
path** -- we do not worry about it overly. If in doubt, leave a comment and move on.

## Contract docstring (move verbatim into `proxy.py`)

The following block is the intended module-level docstring for
`domain/lens/proxy.py`. Move it verbatim.

```python
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
  plain HTTP request/response. See lensProxy-backend-extension.md for how these could
  be added later.

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
```

## Acceptance

- `GET /api/v1/lens/proxy/<id>/wms?service=WMS&request=GetCapabilities` returns the
  same document as hitting the lens port directly (modulo the internal absolute URLs
  it advertises, which the frontend rebases).
- Unknown / non-running `<id>` -> 404. Unauthenticated (non-passthrough) -> 401/403.
- Large tile responses stream without buffering the whole body in memory.
- `# TODO implement granual auth: user-lens matrix` present at the ownership-check
  site.
- `proxy.py` opens with the verbatim contract docstring.
