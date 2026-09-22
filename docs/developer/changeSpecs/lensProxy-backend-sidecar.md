# Lens Proxy -- Offloading Traffic From the Main Worker

## Status and audience

Forward-looking, architect-oriented. Assumes the initial HTTP streaming proxy
(`lensProxy-backend-initial.md`) and the frontend adaptation (`lensProxy-frontend.md`)
are shipped, but that the codebase may have moved on for unrelated reasons. Names below
are anchors, not guarantees.

## The problem

The initial implementation runs the proxy **inside the FastAPI app on a single uvicorn
worker** (`workers=1`, see `entrypoint/bootstrap/launchers.py`). Every lens byte --
WMS tiles, which are many and can be large -- flows through that one async event loop,
contending with all normal API traffic. We accepted this for the first milestone. This
document is about what to do when that becomes a real bottleneck.

Constraints that make this non-trivial, and rule out a naive "just put nginx in front":

- **Auth and lens-id validation live in the backend.** A request to
  `/api/v1/lens/proxy/<id>/...` must be checked for (a) a valid authenticated session
  and (b) that `<id>` maps to a running lens (and eventually: that this user owns it --
  the user-lens matrix). A stock reverse proxy has no knowledge of either. So we cannot
  simply hand the whole route to nginx and forget about it.
- **The mapping id -> internal port is dynamic**, chosen at runtime by the backend's
  `FreePortsManager`. Whatever does the forwarding must learn that mapping from the
  backend.

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
  truth; the Rust code implements the same contract.
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
