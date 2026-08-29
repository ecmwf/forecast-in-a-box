# Deployment

## Content Security Policy

Set the `Content-Security-Policy` header on your reverse proxy (nginx, Traefik, etc.).
Do **not** use a `<meta>` tag — it cannot cover all directives and is ignored for some (e.g. `frame-ancestors`).

### Recommended directives

```
Content-Security-Policy:
  default-src 'self';
  script-src  'self';
  style-src   'self' 'unsafe-inline';
  img-src     'self' data: blob:;
  font-src    'self';
  connect-src 'self';
  worker-src  'self';
  frame-src   'none';
  object-src  'none';
  base-uri    'self';
  form-action 'self';
  frame-ancestors 'none';
```

### Why each directive

| Directive | Value | Reason |
|---|---|---|
| `default-src` | `'self'` | Fallback — only allow same-origin by default |
| `script-src` | `'self'` | Vite outputs hashed JS bundles, no inline scripts needed |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind + runtime style injection (e.g. react-globe.gl / three.js) |
| `img-src` | `'self' data: blob:` | App icons are same-origin; three.js globe textures use `data:` and `blob:` URIs |
| `font-src` | `'self'` | IBM Plex Sans is bundled via `@fontsource-variable` |
| `connect-src` | `'self'` | Fetch API calls, `EventSource` (SSE), and the notification WebSocket, all same-origin. CSP3 lets `'self'` match the page origin's `ws:`/`wss:` scheme upgrade, which every browser this app supports implements |
| `worker-src` | `'self'` | MSW service worker (`mockServiceWorker.js`) in dev/test; omit in production if unused |
| `frame-src` | `'none'` | App does not embed iframes |
| `object-src` | `'none'` | No plugins (Flash, Java, etc.) |
| `base-uri` | `'self'` | Prevent `<base>` tag injection |
| `form-action` | `'self'` | Forms only submit to same origin |
| `frame-ancestors` | `'none'` | Prevent the app from being embedded in iframes (clickjacking protection) |

### Notes

- If you serve the backend on a different origin (e.g. `https://api.example.com`), add it to `connect-src` — including `wss://api.example.com` for the notification WebSocket, since `'self'`'s scheme-upgrade leniency applies only to the page's own origin. Note the geo viewer's lens sources do **not** support this: they are addressed by a relative path under `/api/v1/lens/proxy/`, so lens viewing requires the app and backend to share an origin.
- Reverse proxies in front of the backend must forward WebSocket upgrades on `/api/v1/notification/ws` (nginx: `proxy_http_version 1.1` plus the `Upgrade`/`Connection` headers).
- `'unsafe-inline'` in `style-src` is required because three.js and some UI libraries inject styles at runtime. If this is unacceptable, consider using a CSP nonce strategy.
- `worker-src 'self'` can be removed in production if MSW is not used.

### Geo viewer (map) origins

The `/visualise` map viewer talks to origins beyond `'self'`; a proxy-level
CSP must mirror the allowances the built `index.html` meta CSP carries, or
those features silently fail:

- **Basemap:** `https://basemaps.cartocdn.com` and `https://*.basemaps.cartocdn.com` in `img-src`, `connect-src`, `style-src`, and `font-src`.
- **WMS lens servers** need no allowance of their own: the backend proxies them at `/api/v1/lens/proxy/<id>/`, so lens traffic is same-origin and covered by `'self'`.
- **Loopback WMS servers** the user runs on their own machine and adds by URL: `http://localhost:*` and `http://127.0.0.1:*` in `img-src` and `connect-src`. A single production bundle is served both from a domain and from localhost, and the baked meta CSP cannot tell the two apart, so these stay allowed in both. A proxy-level CSP fronting a domain deployment may drop them.
- **Curated WMS servers** (the built-in list in `src/features/visualise/curated-wms.ts`) are baked into production builds' `img-src`/`connect-src` automatically.
- **Additional WMS hosts** users should be able to add by URL: set `FIAB_CSP_EXTRA_HOSTS` at build time (space-separated source expressions, e.g. `FIAB_CSP_EXTRA_HOSTS="https://my.wms.host https://other.example"`), and mirror them in the proxy CSP.
