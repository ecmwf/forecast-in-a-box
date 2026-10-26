# Lens proxy -- known backend issues

Issues found in `backend/src/forecastbox/domain/lens/proxy.py` (and its route in `routes/lens.py`)
while reviewing how a proxied lens learns its public URL.

None of them is critical for the current deployment, where the backend is reached directly by
clients, with no further reverse proxy (nginx, Traefik, ...) in front of it. Items 1 and 2 become
relevant as soon as such an outer proxy or a sub-path mount is introduced.

## 1. Scheme and host are taken from the backend's own view of the request

`_build_upstream_headers` derives `X-Forwarded-Proto` from `request.url.scheme` and `X-Forwarded-Host`
from the inbound `Host` header. Any outer `X-Forwarded-*` headers are dropped (deliberately, see the
comment on `_FORWARDING_HEADERS`) and not folded in.

Behind a TLS-terminating outer proxy this means:
- the backend sees `http` unless uvicorn runs with `--proxy-headers --forwarded-allow-ips=<outer proxy>`
  (Starlette's `ProxyHeadersMiddleware` rewrites scheme and client, but **not** host);
- the lens is told `X-Forwarded-Proto: http` and emits `http://` self-URLs, causing mixed-content
  failures in an `https` page;
- the host is whatever the outer proxy passes as `Host`, which is only correct if it uses
  `proxy_set_header Host $host` (nginx's default rewrites it to the upstream address).

Possible fixes: document the required uvicorn flags and outer-proxy settings as part of the
contract; or let the proxy accept a configured, trusted set of outer `X-Forwarded-Proto/Host`
values and use them in place of its own view.

## 2. `X-Forwarded-Prefix` ignores an outer mount point

The header is built as `f"{PREFIX}/{lens_instance_id}"`, i.e. `/api/v1/lens/proxy/<id>` only. If the
backend itself is served under a sub-path by an outer proxy (which strips it), the real external
prefix is `<outer prefix>/api/v1/lens/proxy/<id>`, and lenses will emit URLs missing the outer part.

Possible fix: prepend `request.scope["root_path"]` (set by uvicorn `--root-path` or by the outer
proxy's `X-Forwarded-Prefix` via a proxy-headers middleware) to the prefix.

## 3. Upstream path is percent-decoded and not re-encoded

The route captures `upstream_path` as a path parameter, which FastAPI/Starlette has already
percent-decoded. `_build_upstream_url` then interpolates it verbatim into
`http://127.0.0.1:<port>/{upstream_path}`. Consequences:
- an encoded `%3F` or `%23` becomes a literal `?` or `#` upstream, and changes where the path ends
  (the path/query boundary and fragment handling differ from what the client sent);
- an encoded `%2F` becomes a path separator;
- encoded `..` segments (`%2e%2e`) are decoded and passed upstream. This is not an escape from the
  host (the upstream authority is fixed), but the lens sees traversal sequences it would not
  have seen from a direct client, which may interact badly with lenses that serve files.

Possible fix: build the upstream URL from the raw path (`request.scope["raw_path"]`, or
`request.url.path` minus the prefix) or re-quote the captured value with `urllib.parse.quote(...,
safe="/")`; consider rejecting `..` segments outright.

## 4. Malformed `Forwarded` header

The `Forwarded` header is assembled as `proto=...;host=...;for=...` by plain string joining. Per
RFC 7239, values containing `:` (a host with a port, which is common here) or `[`/`]` (IPv6 `for=`)
must be quoted-strings, e.g. `host="example.com:8443"`; the current output is invalid for those
cases. The header is currently ignored by skinnyWMS, but other lenses may parse it.

Possible fix: quote the values, or stop sending `Forwarded` and rely on `X-Forwarded-*` only.

## 5. `Location` and other response headers are not rewritten

The proxy forwards upstream response headers unchanged. A lens that emits a redirect with an
absolute internal `Location` (e.g. `http://127.0.0.1:<port>/...`), or relative-to-root `Location:
/foo`, produces a redirect that bypasses the proxy mount. The same applies to `Set-Cookie` with
`Path=/` and to `Link` headers. Lenses honouring `X-Forwarded-*` produce correct values on their
own, so this only affects lenses that do not.

Possible fix: state this explicitly in the lens contract (lens MUST emit correct `Location`), or
rewrite `Location`/`Set-Cookie Path` for upstream-origin values in the proxy.

## 6. No route for the mount root without a trailing slash

The route is `/proxy/{lens_instance_id}/{upstream_path:path}`, so `/proxy/<id>` (no trailing
slash) does not match and yields a 404 (or a redirect, depending on `redirect_slashes`). Pages served
by a lens at its root (like the skinnyWMS demo) are therefore only reachable at `/proxy/<id>/`.
A lens emitting root-relative or page-relative links can behave differently between the two.

Possible fix: add an explicit redirect from `/proxy/<id>` to `/proxy/<id>/`.

## 7. `X-Forwarded-For` is extended without trust checks

An inbound `X-Forwarded-For` is prepended to the chain unconditionally. With no outer proxy, any
client can therefore inject arbitrary addresses at the head of the chain that the lens will see.
Lenses should only trust the last entry, which is what a single-hop trust configuration does
(skinnyWMS ignores `X-Forwarded-For` entirely).

Possible fix: discard inbound `X-Forwarded-For` unless an outer proxy is explicitly configured as
trusted, in which case keep it.
