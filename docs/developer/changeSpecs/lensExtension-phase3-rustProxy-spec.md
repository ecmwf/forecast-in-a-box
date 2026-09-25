# Phase 3 -- Offloading Lens Traffic From the Main Worker

## Status and audience

Forward-looking, architect-oriented. This is phase 3 of the effort described in
`lensExtension-overview.md`; read that first. It assumes phases 1 and 2 are shipped --
the HTTP streaming proxy and its frontend adaptation are long in place, lenses exist in
both process and native kinds, and the WebDAV lens of
`lensExtension-phase2-webdavLens-spec.md` serves output trees natively. The codebase may
have moved on for unrelated reasons; names below are anchors, not guarantees.

Companion document: `lensExtension-phase3-proxyProtocols-spec.md`, which catalogues
transports beyond plain HTTP request/response.

## The problem

The proxy runs **inside the FastAPI app on a single uvicorn worker** (`workers=1`, see
`entrypoint/bootstrap/launchers.py`). Every lens byte flows through that one async event
loop, contending with all normal API traffic. Two distinct loads do this:

- **process lenses** -- WMS tiles, which are many and can be large, proxied to a
  subprocess;
- **the WebDAV lens** -- file bodies, which are few but very large, read from local disk
  and streamed out. Phase 2 accepted this explicitly as a deferred concern.

We accepted both for their respective milestones. This document is about what to do when
it becomes a real bottleneck.

Constraints that make this non-trivial, and rule out a naive "just put nginx in front":

- **Auth and lens-id validation live in the backend.** A request to
  `/api/v1/lens/proxy/<id>/...` must be checked for (a) a valid authenticated session
  and (b) that `<id>` maps to a running lens (and eventually: that this user owns it --
  the user-lens matrix). A stock reverse proxy has no knowledge of either. So we cannot
  simply hand the whole route to nginx and forget about it.
- **The mapping id -> internal port is dynamic**, chosen at runtime by the backend's
  `FreePortsManager`. Whatever does the forwarding must learn that mapping from the
  backend.

## The WebDAV lens: offload bodies, keep policy

For the proxy the split is easy, because the proxy never interprets what it carries:
policy in Python, opaque bytes in Rust. The WebDAV lens needs more care, and the obvious
reading -- "move WebDAV into the sidecar" -- is the wrong one. It would relocate path
resolution, containment enforcement, listing generation and the resource model itself
into the other language, which means the entire security-critical surface changes
language and, during migration, exists in two places at once.

**Split by load profile instead, which happens to coincide with the policy boundary:**

- **Python keeps deciding and describing.** Authorization, output-to-path resolution,
  containment checks, directory listings and property queries stay where they are. These
  responses are small and infrequent; they are also where all the policy lives.
- **The sidecar streams file bodies only.** Once Python has authorized a request and
  resolved it to a concrete, already-validated path, it delegates the body to the
  sidecar and releases the worker immediately -- the internal-redirect pattern that
  off-the-shelf reverse proxies expose for exactly this purpose.

This captures essentially all of the throughput win, since the bytes are overwhelmingly
file bodies, while keeping the Rust surface small and policy-free. It is available at all
only because the files are local to the backend, which is a further argument for the
native WebDAV lens over a proxied file-server process.

Watch-outs specific to this path: the handoff must convey an already-resolved path and
must not be forgeable or reachable from outside; range and conditional-request handling
moves with the body and must remain correct; and the delegation must not become a way to
name arbitrary files, which means the sidecar trusts Python's resolution and nothing
else.

## Recommended option: a dedicated proxy process, backend as auth/validation authority

Launch, at backend startup, a **dedicated proxy process** whose sole job is forwarding
lens traffic. Written in **Rust** (for throughput and predictable latency under load;
the team already ships Rust in `cli/`). Responsibilities split:

- **Backend** remains the authority for auth and lens-id (and future user-lens)
  validation, and owns the id -> port mapping (it launches the lenses).
- **Proxy process** does the heavy lifting: accepts the proxy-route connections,
  consults the backend for an authorization decision, then streams bytes to/from
  `127.0.0.1:<port>` itself, out of the main event loop.

### Ingress / routing

Something must route `/api/v1/lens/proxy/*` to the proxy process and everything else to
the backend. Two sub-shapes; **prefer the second**:

1. A third front process (e.g. nginx) doing a **static prefix match**: `/.../lens/proxy`
   -> proxy process, everything else -> backend. This is legitimate for nginx because
   the split is a static route prefix; nginx never needs the dynamic id->port map or
   the auth logic. The container exposes only this front process.

2. **The proxy process itself fronts everything**: it terminates the single exposed
   port, handles the proxy prefix natively, and reverse-proxies all other paths to the
   backend. This collapses "front router" and "proxy" into one hop -- simpler mental
   model, one less process, one less network hop. Given the proxy is already a
   competent HTTP proxy, making it the single front door is the smaller conceptual
   surface. Prefer this unless a reason to keep a separate off-the-shelf front door
   appears (e.g. you want nginx's TLS termination / static-file serving / battle-tested
   edge behaviour).

So the container topology becomes, in the preferred shape:

```
world -> [Rust proxy: front door]
              |-- /api/v1/lens/proxy/* : validate w/ backend, then stream to 127.0.0.1:<lens port>
              |-- everything else      : reverse-proxy to 127.0.0.1:<backend port>
         [Python backend (uvicorn, workers=1)] -- launches lenses, owns id->port map,
                                                   serves the auth/validation endpoint
```

### The auth/validation interface

The proxy must get, per lens request (or cached per session+id), an authorization
decision plus the target port. Design choices, roughly in order of preference:

- **Auth-subrequest endpoint on the backend**, e.g.
  `GET /api/v1/lens/_authz/<id>` that takes the caller's credentials (forwarded cookie
  / token) and returns `{ authorized: bool, port: int }` (nginx `auth_request` style).
  The proxy caches the decision briefly (per session+id, short TTL) to avoid a backend
  round-trip per tile. Simple, keeps all policy in Python, tolerates backend evolution.
- **Push the mapping + a validation hook to the proxy**: backend notifies the proxy of
  id->port on lens start/stop (so the proxy resolves the port locally) but still calls
  back for the auth decision. Lower latency for the port lookup; more state to keep
  consistent (leaks if a stop notification is missed -- add reconciliation).
- **Signed capability tokens**: backend hands the client a short-lived signed token
  scoping `<id>` (and later the user); the proxy validates the signature locally with a
  shared key and needs no per-request backend call. Fastest, but introduces key
  management and token-lifetime/revocation concerns; hardest to get right. Consider
  only if the subrequest round-trip proves too costly even with caching.

### Watch-outs for the recommended option

- **Credential forwarding.** The proxy must forward the caller's auth (JWT cookie) to
  the backend's authz endpoint faithfully; get cookie domain/path right so the same
  cookie authenticates both the SPA and the proxy.
- **Lens lifecycle races.** A lens can die or be stopped mid-stream. The proxy needs
  clean handling of connection-refused / mid-stream reset (map to 502/503), and the
  cached authz/port entries need invalidation on stop. If the backend pushes state,
  handle missed notifications with periodic reconciliation.
- **Startup ordering & health.** The proxy is now the front door; it must come up,
  discover the backend, and pass health checks before the container is "ready". Mind
  `entrypoint/main.py` / bootstrap health-check flow -- the readiness probe target
  changes.
- **Forwarded headers / URL contract unchanged.** The contract in
  `domain/lens/proxy.py` (client rebasing, `X-Forwarded-*`, no body rewriting) must be
  honoured identically by the Rust proxy. Keep that docstring the single source of
  truth; the Rust code implements the same contract. The same applies to the WebDAV
  lens's own contract docstring.
- **Credential positions.** Lens access may be authorized by a short-lived scoped token
  presented as a header, a Basic password or a query parameter, as well as by an
  ordinary session. Whatever the sidecar forwards to the authorization endpoint must
  preserve all of these faithfully.
- **Streaming semantics.** Preserve range requests, chunked responses, disconnect
  propagation, and backpressure -- the same properties the Python version had.
- **Operational surface.** A second long-lived process to supervise, log, crash-restart
  and version in lockstep with the backend. Include it in the shutdown/sigterm
  propagation already handled for child processes.

### Limitations

- More moving parts and a cross-language boundary (Python policy, Rust data plane). The
  authz interface is now a versioned internal contract that both sides must respect.
- The auth-subrequest cache introduces a small window where a just-revoked session may
  still stream; bound it with a short TTL.
- Does not, by itself, solve horizontal scaling across pods (the lens processes are
  local to the backend pod); this is about offloading within a pod, not distributing
  lenses.

## Alternatives considered

- **Implementing the WebDAV lens itself in the sidecar.**
  *Why not:* it moves path resolution, containment enforcement and the resource model
  into Rust, i.e. the whole security-critical surface changes language and is duplicated
  during migration, for a throughput gain that body-only delegation already captures.

- **Off-the-shelf reverse proxy (nginx/traefik/envoy) doing the whole lens route.**
  *Why not:* it cannot make the auth / lens-id / user-lens decision, and cannot resolve
  the dynamic id->port map, without bespoke integration (Lua/`auth_request`, dynamic
  upstream config). At that point you have reimplemented most of the custom proxy inside
  someone else's extension model, with worse ergonomics. *If you must:* use nginx purely
  as the **static-prefix front door** (option 1 above) and keep auth+forwarding in our
  own process; use `auth_request` against the backend's authz endpoint and a dynamic
  upstream (resolver + variable) fed by the backend -- and accept the config complexity.

- **More uvicorn workers / a separate uvicorn app for the proxy route.**
  *Why not:* multiple workers complicate the in-process `FreePortsManager` and
  `LensInstanceManager` state (currently single-process, lock-guarded, lock-free
  reads) -- the id->port map would need to be shared across workers. It also keeps the
  data plane in Python, which is the throughput concern we are trying to escape. *If you
  must:* run the proxy as a **separate** Python ASGI app (not just more workers of the
  main app) that queries the backend for authz+port over a small internal API, so the
  lens-state ownership stays single-process in the backend. You get process isolation
  without Rust, at the cost of Python's throughput ceiling.

- **In-process but move forwarding to a threadpool / raw asyncio streaming tuning.**
  *Why not:* it still burns the main process's CPU and event loop; buys headroom, not a
  category change. *If you must:* ensure zero whole-body buffering, generous connection
  pooling to the lenses, and cap concurrent lens streams so they cannot starve the API;
  treat it strictly as a stopgap before the dedicated process.

- **Signed-token-only, no dedicated process (client talks to lens through a thin edge).**
  *Why not:* without a data-plane process you are back to the main worker doing the
  bytes; the token only removes the authz round-trip, not the load. Only meaningful in
  combination with the dedicated proxy above, as an optimisation of its authz interface.

## What later phases expect from this task

Nothing depends on this phase. It is an optimisation, and phase 4 is independent of it.
