# Lens Proxy -- Frontend Adaptation

## Context

This spec assumes `lensProxy-backend-initial.md` has been implemented in the **same
pull request**. The backend no longer serves lenses on their own dynamic port; a lens
is reachable only via:

    /api/v1/lens/proxy/<lens_instance_id>/<upstream path>[?<query>]

We do synchronized releases and this ships together with the backend change, so there
is **no backwards compatibility** to preserve: remove the direct-port path entirely.

## Current frontend behaviour (to be changed)

- `src/api/endpoints/lens.ts`:
  - `buildLensBaseUrl(port)` builds `http(s)://<backendHost>:<port>` -- a direct
    origin on the lens's dynamic port.
  - `buildWmsCapabilitiesUrl(port)` builds the GetCapabilities URL off that.
- `src/features/visualise/hooks/useComparisonSource.ts` reads
  `detail.ports[0]` and calls `buildLensBaseUrl(port)` to produce the `baseUrl` for a
  running lens source.
- `src/features/viewer/wms-capabilities.ts`:
  - `toWmsEndpoint(baseUrl)` -- for a bare origin base (`pathname === '/' && !search`)
    it appends `/wms`; otherwise returns the base verbatim (treats it as an external,
    fully-formed endpoint).
  - `rebaseLensUrl(url, baseUrl)` -- grafts `baseUrl` onto the upstream URL's
    path+query **only when** `baseUrl` has a root pathname and no query; otherwise it
    returns the upstream URL verbatim (the "external endpoint" branch).
  - `isLoopbackUrl(url)` -- true for `localhost` / `127.0.0.0/8` / `[::1]`; used to
    pick a more patient GetCapabilities retry ladder while skinnyWMS boots, and to
    reason about CORS.

The key problem: the new lens base URL is a **same-origin path** with a non-root
pathname (`/api/v1/lens/proxy/<id>`). Under the current logic, `toWmsEndpoint` and
`rebaseLensUrl` would both take their "external endpoint / use verbatim" branch,
because they special-case only root-pathname bases. That is wrong for the proxy base:
we still need `/wms` appended and we still need the lens's internally-advertised
absolute URLs (e.g. `http://0.0.0.0:<port>/wms?...` in GetCapabilities) rebased onto
the proxy path.

## Goal of this task

Adapt the frontend so that a running lens is addressed via the proxy path, and WMS URL
handling works with a non-root, same-origin base.

### 1. Build the lens base URL from the instance id, not the port

In `src/api/endpoints/lens.ts`:

- Replace `buildLensBaseUrl(port: number)` with a function that takes the lens
  instance id and returns the same-origin proxy base, e.g.:

  ```ts
  export function buildLensBaseUrl(lensInstanceId: string): string {
    // Same-origin proxy path; the backend forwards to the internal lens process.
    return `${API_ENDPOINTS.lens.proxyBase}/${encodeURIComponent(lensInstanceId)}`
  }
  ```

  where a new `proxyBase` (e.g. `${API_PREFIX}/lens/proxy`) is added to
  `src/api/endpoints.ts` under the `lens` group.

- The base is now relative (same origin). Consumers that need an absolute URL (e.g. to
  paste into an external WMS client) should resolve it against
  `getBackendBaseUrl() || window.location.origin`. Provide a small helper if needed;
  the in-app viewer can use the relative base directly since fetches are same-origin.

- Update `buildWmsCapabilitiesUrl` to take the instance id and build
  `${buildLensBaseUrl(id)}/wms?service=WMS&version=1.3.0&request=GetCapabilities`.

- The instance detail's `ports` field is no longer needed by the client for
  addressing. It may remain in the response type (the backend still returns it) but the
  frontend must not use it to construct URLs. Consider dropping its use entirely.

### 2. Feed the instance id (not the port) through the source hook

In `src/features/visualise/hooks/useComparisonSource.ts`:

- Where it currently does
  `const port = detail?.status === 'running' ? detail.ports[0] : undefined` and
  `baseUrl: buildLensBaseUrl(port)`, switch to using
  `detail.lens_instance_id` (already present on the detail) and
  `buildLensBaseUrl(detail.lens_instance_id)`.
- Keep the `phase: 'running'` gate on `detail.status === 'running'`.

### 3. Make WMS URL handling prefix-aware

In `src/features/viewer/wms-capabilities.ts`, the base is now a same-origin path like
`/api/v1/lens/proxy/<id>` (no query). Two functions need to treat "our lens base" as a
rebasing target rather than an opaque external endpoint.

The cleanest approach is to distinguish "our lens proxy base" from "a fully-formed
external WMS endpoint" explicitly, rather than inferring it from `pathname === '/'`.
Options (pick one, keep it simple):

- **Preferred:** pass an explicit flag/branch. Since the code already threads a
  `baseUrl` that originates from `buildLensBaseUrl`, mark lens sources distinctly (the
  source object already knows it is a lens vs an external/curated WMS). Then:
  - `toWmsEndpoint`: for a lens base, append `/wms` (join respecting the existing
    trailing-slash handling) regardless of pathname.
  - `rebaseLensUrl`: for a lens base, always graft the upstream URL's `pathname +
    search` onto the lens base (strip any trailing slash on the base first), regardless
    of the base's own pathname. This makes the lens's internally-advertised absolute
    URLs (which still contain the internal `0.0.0.0:<port>`) resolve through the proxy.

- If threading a flag is awkward, recognise the proxy prefix by string
  (`baseUrl.includes('/lens/proxy/')`) -- acceptable but less clean; document it.

Concretely, `rebaseLensUrl` should, for a lens base:

```ts
const upstream = new URL(url)  // url may be http://0.0.0.0:<port>/wms?...
return `${lensBase.replace(/\/$/, '')}${upstream.pathname}${upstream.search}`
```

so `http://0.0.0.0:41234/wms?...` becomes `/api/v1/lens/proxy/<id>/wms?...`.

### 4. Loopback / retry-ladder handling

`isLoopbackUrl` was used to (a) pick the patient retry ladder for our own booting
SkinnyWMS and (b) reason that our lens is not CORS territory.

- The base is now same-origin and relative, so `new URL(base).hostname` is the app's
  own host -- `isLoopbackUrl` will no longer reliably identify "our lens" (it may be a
  public hostname behind an ingress). Replace the "is this our lens" decision with the
  explicit lens-source signal used in step 3, so the patient
  `LOOPBACK_RETRY_DELAYS_MS` ladder still applies while SkinnyWMS boots (see
  `useLensSource.ts`, which selects the ladder via `isLoopbackUrl(baseUrl)`).
- CORS is no longer a concern for lens traffic (same-origin), so any CORS-motivated
  branching for lenses can be simplified/removed. External/curated WMS servers keep
  their existing treatment.

### 5. Same-origin cleanups

- Remove any code that special-cased the cross-origin direct-port lens (e.g.
  `crossOrigin` handling that existed solely because the lens was a different origin).
  Same-origin means normal fetch/tile loading; keep `crossOrigin` only where external
  WMS servers still need it.

## Non-goals

- No dual-mode / feature flag. One breaking switch.
- No handling of WebSocket/SSE lens traffic (backend does not support it yet).
- No change to the lens start/status/stop/list API calls other than how the base URL
  is derived.

## Acceptance

- Starting a skinnyWMS lens and opening the geo viewer loads GetCapabilities and tiles
  through `/api/v1/lens/proxy/<id>/...`, same-origin, with no direct `:<port>` requests
  in the network tab.
- The lens's internally-advertised absolute URLs (GetMap/GetLegendGraphic hrefs from
  GetCapabilities) are rebased onto the proxy path and load correctly.
- The patient retry ladder still applies while SkinnyWMS is booting.
- No remaining use of `detail.ports[*]` for URL construction.
