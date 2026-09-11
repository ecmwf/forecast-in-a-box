# Phase 3 -- Extending the Lens Proxy Beyond HTTP Streaming

## Status and audience

This is a forward-looking, architect-oriented note, filed under phase 3 of the effort
described in `lensExtension-overview.md` because it shares that phase's subject matter --
the transport layer of the lens proxy -- though it is independent of the offloading work
in `lensExtension-phase3-rustProxy-spec.md` and may never be needed at all.

It assumes the HTTP streaming proxy and its frontend adaptation are in place, but that
the codebase may have evolved considerably in unrelated ways since. Treat file/function
names below as anchors to re-locate, not as guarantees.

Nothing here may ever be needed. It exists so that, when a lens type or a client shows
up that needs more than plain HTTP request/response, the person doing it has a map of
the terrain and of the decisions already baked into the contract.

Note that the native lens kind introduced in phase 2 sidesteps this document entirely:
a protocol the backend speaks itself needs no tunnelling. This note concerns process
lenses, which are reached only through the proxy.

## The framing that still holds

The proxy exists because we want a **static set of exposed ports**, with lenses
reachable via a path prefix on the backend's port. The contract docstring in
`domain/lens/proxy.py` is the source of truth for what clients and lenses may assume.
Any extension here means **extending that contract** and updating that docstring in the
same change -- otherwise clients (frontend, CLI, and whatever else exists by then)
have no way to know the new capability is available.

Also recall: with a **browser** client you are limited to what browsers can originate
(HTTP, WebSocket, SSE/fetch-streaming). The moment a non-browser client (the `cli/`) is
in play, that ceiling lifts and genuinely arbitrary transports become conceivable --
at the cost of the client having to speak whatever tunnelling scheme we define. Decide
per-transport whether browser support is required; it strongly shapes the design.

## WebSocket

Most tractable extension; browsers speak it natively.

- Starlette/FastAPI support a `@app.websocket_route` / `WebSocket` endpoint. Add a
  websocket route mirroring the HTTP proxy path, e.g.
  `/api/v1/lens/proxy/{lens_instance_id}/{path:path}` on the WS side.
- On connect: run the same instance-resolution + auth as the HTTP path (note: browser
  WebSocket handshakes cannot set arbitrary headers, so cookie-based auth is the
  realistic path; the existing JWT cookie transport helps here).
- Open an upstream WebSocket to `ws://127.0.0.1:<port>/<path>` (the `websockets`
  package is already a dependency) and pump frames bidirectionally with two tasks
  (client->upstream, upstream->client), propagating close codes and reasons, and
  cancelling the sibling task on either side closing.
- Forward the `Sec-WebSocket-Protocol` subprotocol negotiation and the `X-Forwarded-*`
  headers on the upstream handshake.
- Watch-outs: backpressure (don't let one side outrun the other unboundedly),
  half-close semantics, ping/pong keepalive, and the fact that every open socket pins
  an event-loop task on the single worker -- reinforces the sidecar discussion
  (`lensExtension-phase3-rustProxy-spec.md`).

## Server-Sent Events (SSE) and long-lived streaming HTTP

- Mechanically these already "work" over the HTTP streaming proxy: the response body is
  streamed. The problem is **lifetime** -- a kept-open SSE stream holds a connection
  (and, on the single worker, contends with everything else) indefinitely.
- If SSE becomes a first-class lens capability, add: explicit disabling of any response
  buffering/`Content-Length` re-framing, idle timeouts, a cap on concurrent long-lived
  streams per user, and disconnect detection so upstream connections are torn down when
  the client goes away. Document in the contract that SSE lenses are supported but
  count against a concurrency budget.

## Arbitrary TCP (and the "any protocol" dream)

This is where "it's just up to us how many options we implement" is technically true
but the cost jumps.

- **Non-browser clients only.** A browser cannot open a raw TCP socket, so this is a
  CLI-and-friends feature. Do not promise it to the frontend.
- Two broad shapes:
  1. **Tunnel over HTTP/WebSocket.** Define a framing (e.g. length-prefixed binary over
     a WebSocket, or HTTP `CONNECT`-style semantics) at
     `/api/v1/lens/proxy/{id}/_tcp`. The proxy opens a raw TCP connection to
     `127.0.0.1:<port>` and shovels bytes both ways. The client library (in `cli/`)
     must implement the same framing. Auth/validation reuse the HTTP path's logic.
  2. **Dedicated port range with per-connection auth.** Rejected in spirit by the whole
     premise of this feature (static ports), but noted for completeness -- if a
     transport truly cannot be tunnelled, the only alternative is exposing more ports,
     which is exactly what we set out to avoid.
- Watch-outs: with raw byte tunnelling you lose all protocol awareness -- no URL
  rebasing, no header injection, no per-request auth (auth is per-tunnel). The
  security surface widens: a tunnel is effectively "authenticated user gets a socket to
  an internal port", so instance-scoped (and eventually user-scoped) validation at
  tunnel-open time is the only gate. UDP does not tunnel cleanly over TCP-based
  transports; treat it as out of scope unless a concrete need appears.

## Cross-cutting concerns for any extension

- **Contract first.** Extend the `domain/lens/proxy.py` docstring and bump whatever
  client-facing capability discovery exists (e.g. `/lens/supported` could grow to
  advertise which transports a lens type offers).
- **Auth parity.** Every new transport must run the same instance validation and (once
  it exists) the user-lens matrix check. Do not let a new transport become an auth
  bypass.
- **Worker pressure.** WebSocket and long-lived streams multiply the "single worker"
  concern. If any of these ship at scale, the sidecar/offload design becomes a
  prerequisite, not an optimisation -- see `lensExtension-phase3-rustProxy-spec.md`.
- **Client symmetry.** Each transport needs matching support in every client that will
  use it. HTTP is free (any HTTP client); WebSocket needs a WS client; raw tunnelling
  needs a bespoke client library. Budget for the client side, not just the backend.
