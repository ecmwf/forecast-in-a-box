# Geographic Comparison Mode — Implementation Plan & Progress

> Living document for the `feat/geo-comparison` branch. Another agent (or human)
> can recheck the implementation against this plan. Keep the progress checklist
> and "deviation log" up to date as work lands.

## Progress

- [x] Phase 0 — MSW WMS mocks + WmsViewer characterization tests
- [x] Phase 1 — Extract shared viewer core into `src/features/viewer/` (WmsViewer 2597→~630 lines; utils → hooks → components in three commits; characterization green throughout)
- [ ] Phase 2 — Comparison basket, entry points, contextual nav tab
- [ ] Phase 3 — `/compare` route, page shell, lens orchestration (incl. host-path source form)
- [ ] Phase 4 — Comparison viewer (side-by-side, swipe, experimental modes)
- [ ] Phase 5 — External WMS URL sources (+ stretch: GeoJSON overlays)
- [ ] Phase 6 — Polish + full verification

### Deviation log

- Host-path source form pulled forward from Phase 5 into Phase 3 so the page is
  manually testable with local GRIB dirs (e.g. `~/.fiab/jobs_output/...`) before
  any new runs are needed.

## Context

FIAB can visualize one run's GRIB output via a SkinnyWMS "lens" (one server per
output dir, dynamic port 19000–19099, up to ~100 concurrent — backend already
supports this). The viewer (`WmsViewer.tsx`, OpenLayers 10, ~2,600 lines) is
hard-bound to a single lens `baseUrl` and lives in a bottom sheet. Users cannot
compare geographic outputs across runs (e.g. AIFS vs. IFS-based forecast of the
same event), nor bring in external geodata.

**Goal:** a comparison basket + dedicated `/compare` page where 2 sources at a
time are compared in synchronized OpenLayers views — swipe divider,
side-by-side, plus experimental flicker / spy-glass / blend modes — with
sources drawn from stored run outputs, already-running lenses, external WMS
URLs, or host-side GRIB directories.

**User-confirmed decisions**

- N-item basket (cap 8), viewer compares **2 at a time** with a switcher.
- **Contextual "Compare" nav tab** with count badge, visible only when basket
  non-empty (RunNavItem pattern).
- **Linked layer selection by default** (matched by parameter + level);
  auto-degrade to unlinked when layer sets don't overlap; manual link/unlink
  toggle.
- All three extra modes (**flicker, spy glass, blend**) built as cheap,
  individually removable controllers — they are experiments to evaluate.
- External data v1: **external WMS URL** + **host-side path → lens**.
  Client-side GeoJSON overlays only as a stretch step; defer if non-trivial.
  Browser upload = backend follow-up.
- UX confirmed on the wireframe artifact: default mode **swipe**; basket chip
  click → assigns that entry to slot **B** (clicking current A swaps A↔B);
  layer browser as collapsible **right sidebar**; time gaps **hide + badge
  only** (exact valid-time matches; snap-to-nearest is a later toggle).

## Architecture

### Source model (discriminated union — the key unification)

A comparison **source** is anything that yields a WMS base URL:

```ts
type ComparisonEntry =
  | { kind: 'output'; jobId: string; taskId: string; blockId: string;
      runName: string; blockTitle: string; runCreatedAt: string | null; addedAt: number }
  | { kind: 'path'; path: string; label: string; addedAt: number }     // host dir → lens
  | { kind: 'wms';  url: string;  label: string; addedAt: number }     // direct external WMS
```

Stable entry ref (URL + store identity), codec in
`src/features/compare/entry-ref.ts`:
`run:<jobId>~<taskId>` · `path:<path>` · `wms:<url>` (router URL-encodes values).

Resolution pipeline per source kind:

- `output`: resolve GRIB dir (marker payload) → match running lens by
  `local_path` → else auto-start → poll → `buildLensBaseUrl(port)`
- `path`: same, skipping dir resolution (the path IS the `local_path`)
- `wms`: immediately "running" with `baseUrl = url` (capabilities fetch is the
  health check)

### New/changed layout

```
src/features/viewer/                  # NEW — shared viewer core extracted from WmsViewer
  wms-capabilities.ts                 # MOVED verbatim (+ its unit test)
  format.ts / ol-layers.ts / map-export.ts        # pure utils (exportMapPng reusable)
  hooks/ useLensSource.ts useOlMapBase.ts useBasemap.ts useWmsLayerStack.ts usePointerReadout.ts
  components/ TimeSlider LegendImage PinnedLegendsBar ActiveLayersPanel
              LayerBrowserPanel WmsOverviewPanel MapTitleBar CollapsedSidebarHandle
  compare/  ComparePage CompareViewer CompareToolbar SingleMapCompare DualMapCompare
            SwipeController SpyGlassController FlickerController BlendController
            ComparePanelLabel LinkedLayerBrowser CompareTimeSlider
            useCompareSelection.ts layer-pairing.ts compare-timeline.ts
src/features/compare/                 # NEW — basket + integration (non-viewer)
  entry-ref.ts
  stores/comparisonStore.ts
  hooks/ useComparisonSource.ts useLensPathIndex.ts
         useHydrateComparisonFromUrl.ts useEnrichComparisonEntry.ts
  components/ AddToComparisonButton.tsx ComparisonSourcePicker.tsx
src/routes/_authenticated/compare.tsx # NEW route (tree auto-generates)
src/features/executions/components/WmsViewer.tsx  # shrinks to composition, SAME public API
src/features/executions/outputs/stored-dir.ts     # extracted storedDirQueryOptions + useStoredDirPath
src/components/layout/NavToggle.tsx   # + CompareNavItem
```

Existing `WmsViewer` mount sites (`ActiveLensesCard.tsx`,
`StoredOutputsCard.tsx`) stay untouched — public API remains
`<WmsViewer baseUrl={...} />`.

### Key hook generalizations (from single-source WmsViewer)

- `useLensSource(baseUrl, { rebaseUrls })` → `{ status, error, layers,
  decorationLayers, bbox, groups, partitioned, retry }`. Capabilities fetch
  keeps the existing retry ladder (300…4800 ms). `rebaseLensUrl` applied
  **only** for lens-backed sources; external WMS uses advertised URLs as-is.
- `useWmsLayerStack(mapRef, baseUrl, layers, config)` — the managed-layer
  reconciliation generalized with:
  - `zBase` banding (basemap 0, stack A 100+, stack B 200+, reference overlay
    1000; single viewer passes `zBase: 0` → byte-identical z math),
  - `masterOpacity` (drives blend/flicker), per-layer opacities, `activeOrder`,
  - `resolveTime(layer) => string | null` (per-source raw TIME string),
  - returns `{ stackRef, revision }` — `revision` bumps on each reconciliation
    so clip controllers re-attach listeners.
- `useOlMapBase(containerRef, { view, ... })` accepts an **external `ol/View`**
  so two maps can share one.

### OL mechanics (invariants — do not violate)

- `ImageWMS` stays `hidpi: false, ratio: 1, crossOrigin: 'anonymous'` (Magics
  symbol sizing; canvas export).
- **Never set `className` on layers** — preserves OL canvas sharing that both
  the per-layer clip semantics and the `querySelector('canvas')` PNG export
  depend on. Document in `ol-layers.ts`.
- Swipe/spy clip: `prerender` (build path via `getRenderPixel(evt, cssPx)` —
  never multiply by DPR — then `ctx.clip()`) + `postrender` (`ctx.restore()`)
  on every stack-B layer. Divider = pointer events + `setPointerCapture`; write
  fraction to a **ref**, `map.render()` per move; listeners attach once per
  `[revision, mode]`, detached in effect cleanup (`layer.un`).
- Flicker: swap per-stack `masterOpacity` between 0/1 (NOT `visible:false` —
  opacity-0 keeps the decoded image, swap is instant, zero requests).
  Space-key + button.
- Blend: stack-B `masterOpacity` = slider value.
- Side-by-side: two `OlMap`s sharing **one `View` instance** — native
  pan/zoom/rotation sync, no event plumbing. Per-map basemap (layers can't be
  shared across maps).
- Mode switching single↔dual **remounts** the map component; the shared `View`
  ref survives, so camera persists and images re-serve from HTTP cache. Never
  keep both maps alive hidden. Switching among single-map modes only swaps the
  small controller component.

### Linked selection (`layer-pairing.ts` + `useCompareSelection.ts`)

- Pair key = `${paramBase}@${level ?? 'sfc'}` (reuse `groupLayers` level
  detection; `single:` groups pair on exact layer name — SkinnyWMS names like
  `2t`/`msl` are pipeline-stable).
- `PairedLayer.perSource` presence = availability; browser rows show
  availability chips (A ✓ / B —, tooltip). One-sided pairs remain addable
  (render on the side that has them).
- State: `linkMode: 'linked' | 'unlinked'`; both-ready + `overlapCount === 0` →
  force unlinked + inline notice. Linked→unlinked copies derived per-source
  orders (lossless); unlinked→linked rebuilds from union.
- Unlinked mode: sidebar becomes two tabs (A/B), each embedding the extracted
  `LayerBrowserPanel` + `ActiveLayersPanel` per source.

### Valid-time alignment (`compare-timeline.ts`)

- **Key on epoch ms, never strings** — the same instant can be advertised with
  different string forms by two servers. Keep `rawByEpoch: Map<number, string>`
  per source and send each server **its own advertised raw string** as `TIME`.
- Shared slider over the **union** of epochs with a per-source availability
  track (solid/hollow segments) + "No data at this time — A" badge; a source
  missing the current epoch gets `masterOpacity` forced to 0 (exact-only v1;
  "snap to nearest" is a later cheap toggle since the resolver signature
  supports it).
- Autoplay reuses extracted `TimeSlider`; index re-location by epoch when
  sources/layers change.

## Integration details

### Basket store (`src/features/compare/stores/comparisonStore.ts`)

- Zustand, mirror `uiStore.ts` persistence exactly: `devtools(persist(...))`,
  key `STORAGE_KEYS.stores.comparison` (`'fiab.store.comparison'`),
  `STORE_VERSIONS.comparison = 1`, `partialize` to `{ entries }`.
- `MAX_COMPARISON_ENTRIES = 8`; `addEntry` returns
  `'added' | 'duplicate' | 'full'` (pure — callers toast).
- Primitive selectors to avoid re-render storms: `useComparisonCount()`,
  `useIsInComparison(ref)`.

### Entry points

- **`AddToComparisonButton`** (`GitCompareArrows` icon; in-basket →
  `variant="secondary"` + `Check` + `aria-pressed`; toasts
  `compare:toast.added/removed/full`).
- **`StoredOutputsCard`**: button first in each row's action group,
  `disabled={!row.isAvailable}`; new optional `runName` prop passed from
  `RunDetailPage` (`fableData?.display_name`). Prereq: extract
  `useStoredDirPath` → `src/features/executions/outputs/stored-dir.ts` as
  `storedDirQueryOptions(jobId, taskId)` (keeps key
  `['job-result','stored-dir',jobId,taskId]`, `staleTime: Infinity`) so the
  compare page shares the cache.
- **`ActiveLensesCard`**: `useLensPathIndex()` maps
  `local_path → {jobId, taskId, blockId}` (via `useJobsStatus` + `useQueries`
  over `storedDirQueryOptions`); matched lens rows get the Add button,
  unmatched rows get it disabled with a hint.
- **`CompareNavItem`** in `NavToggle.tsx` after `RunNavItem`: renders `null`
  at count 0; `GitCompareArrows` + count badge (`text-[10px]` metadata-chip
  exception); subscription inside the leaf component.

### Route + URL state (`/compare`)

```ts
validateSearch: z.object({
  a: z.string().optional(),   // entry ref (run:/path:/wms:)
  b: z.string().optional(),
  mode: z.enum(['swipe', 'side', 'flicker', 'spy', 'blend']).optional(),  // default 'swipe'
  time: z.string().optional(),
})
```

- URL = shareable projection (active pair, mode, time). Basket = localStorage.
  Dir paths / lens ids / ports = runtime-only.
- Deliberate deviation from omit-defaults: `a`/`b` are always materialized once
  the basket has entries (the "default pair" depends on client-local state) —
  code comment explains why. Switcher writes `a`/`b` with `replace: true`.
- `useHydrateComparisonFromUrl`: refs not in basket → validate (`run:` via
  `ensureQueryData(job status)` + `outputs[taskId].mime_type === GRIB_DIR_MIME`;
  `path:`/`wms:` are self-contained) → add stub entry; invalid → toast + strip
  ref (replace).
- `useEnrichComparisonEntry`: fills `runName`/`blockTitle`/`runCreatedAt` for
  stub `output` entries via `useJobStatus` → `useFableRetrieve` → catalogue
  factory title; writes only on change. Snapshots keep the basket readable
  after run deletion.

### Source orchestration (`useComparisonSource.ts`)

State machine: `idle → resolvingDir → starting → running | failed` (with
`dirError` + `retry`).

- Match running lens from `useLensList()` (existing 5 s poll) by `local_path`,
  prefer `running`.
- **Idempotent auto-start**: module-level
  `pendingStartByPath: Map<string, Promise<string>>` (two panels sharing a path
  start exactly one lens) + per-instance `attemptedPathsRef`. Start via
  `useStartSkinnyWms` (invalidates `lensKeys.list()`); poll `useLensStatus`
  (1 s while `starting`).
- Externally stopped lens → status terminal → `failed` → `retry()` clears
  guards and restarts.
- **No auto-stop on leave** (existing behavior). Page-header "Stop lens
  servers" (`Square`): stops lenses whose `local_path` matches basket entries;
  sets `lensesPaused` so `autoStart` is suppressed; panels then show manual
  Start.
- `wms` entries: skip everything, `phase: 'running'` with `baseUrl = url`.
  Capabilities failure surfaces via `useLensSource` error state with a CORS
  hint.

### Source picker (`ComparisonSourcePicker`)

One component, used as empty state and in an "Add source" dialog. Sections:

1. **Recent runs** with ≥1 `GRIB_DIR_MIME` output (`useJobsStatus(1, 20)` +
   `useForecastRuns` for names/dates; one row per sink block, same dedupe as
   `StoredOutputsCard.rows`). Client-side search; page-1-only is a documented
   limitation.
2. **Running lenses** (`useLensList` + `useLensPathIndex`; unmatched → disabled
   hint).
3. **External** (host path lands in Phase 3, WMS URL in Phase 5):
   - *Host path*: text input for a directory on the FIAB host → adds `path:`
     entry; lens start errors (400 path missing) surface on the panel.
     Help text references e.g. `~/.fiab/jobs_output/...`.
   - *WMS URL*: text input → validate by fetching GetCapabilities; on success
     add `wms:` entry (label defaults to hostname, inline-editable). Errors
     distinguish CORS/unreachable/parse.

### Compare page composition

`PageHeader` (actions: Add source / Stop lenses / Clear basket) → **basket
strip** (chips: label, block, date, remove ✕, A/B active markers;
click-to-activate switcher) → mode toolbar → panels/viewer. Per-panel chrome
renders `starting`/`failed`/`stopped` states around the viewer; viewer mounts
when both sources are running (single source selected → single-map view with an
invite to pick B). Panel labels: output entries `runName · blockTitle ·
createdAt`; path/wms entries user-editable label.

### i18n

- `common.json`: `nav.compare`.
- New **`compare`** namespace (`src/locales/en/compare.json`), registered in
  `src/lib/i18n.ts` + `src/types/i18next.d.ts`: `page.*`, `entry.*`, `toast.*`,
  `basket.*`, `picker.*` (incl. external-form keys), `lens.*`, `panel.*`,
  `modes.*`, `timeline.*`.
- Extracted viewer components keep `useTranslation('executions')` in the
  extraction phase (minimal diff); namespace migration is a possible follow-up.

## Implementation order (each step lands green: `npm run validate:fix`)

**Phase 0 — safety net (no src changes)**

1. `mocks/handlers/wms.handlers.ts` + `mocks/data/wms.data.ts`:
   `registerMockWmsServer(port, {layers, ...})` → capabilities XML;
   GetMap/GetLegendGraphic → 1×1 PNG; unregistered port → 503 (exercises
   retry); Carto basemap style stub.
2. **Characterization test** of the *current* `WmsViewer`
   (`tests/integration/features/executions/wms-viewer.test.tsx`): overview
   grid, add layer, level popover, time slider, 503-then-200 retry. This is
   the parity harness for the refactor.

**Phase 1 — extraction (behavior-identical, verified by Phase 0 tests)**

3. Move `wms-capabilities.ts` (+ unit test) to `src/features/viewer/`; create
   `format.ts`, `ol-layers.ts`, `map-export.ts` (refactor `exportPng` body →
   reusable `exportMapPng(map, opts)`).
4. Extract hooks: `useLensSource`, `useOlMapBase` (external View),
   `useBasemap`, `usePointerReadout`; `WmsViewer` consumes them.
5. Extract `useWmsLayerStack` (`zBase`/`resolveTime`/`revision`); `WmsViewer`
   passes `zBase: 0`. Riskiest step — verify time scrubbing, reorder, opacity,
   removal via tests + manual smoke in both sheets.
6. Extract presentational components (TimeSlider, panels, legends, title bar;
   `PinnedLegendsBar` prop generalization with optional `sourceLabel`).

**Phase 2 — basket + entry points + nav**

7. `storage-keys.ts` additions; `entry-ref.ts` (+ kind prefixes) and
   `comparisonStore.ts` (+ unit tests).
8. `stored-dir.ts` extraction; i18n namespace registration;
   `AddToComparisonButton`; wire into `StoredOutputsCard` (+ `runName` prop)
   and `ActiveLensesCard` (+ `useLensPathIndex`); `CompareNavItem`. Extend
   existing integration tests (stored-outputs-card, active-lenses-card,
   nav-toggle).

**Phase 3 — /compare page shell + orchestration**

9. Route file + `ComparePage` skeleton: basket strip, chip-click→B switcher,
   URL normalization.
10. `useComparisonSource` (with `ensureLensStarted` idempotency guards) +
    per-panel chrome + Stop-lenses with pause semantics.
11. `useHydrateComparisonFromUrl` + `useEnrichComparisonEntry`;
    `ComparisonSourcePicker` (runs + lenses + **host-path form**). Interim:
    each running panel renders the extracted single-source viewer so the page
    is already useful before Phase 4.
12. MSW: second GRIB run in `mocks/data/job.data.ts`,
    `mockBlobForMime(mime, runId?)`; integration test `compare-page.test.tsx`
    (empty state → add 2 → both panels running; same-path idempotency →
    exactly 1 lens; shared-URL hydration incl. invalid ref; stop-lenses → no
    auto-restart).

**Phase 4 — comparison viewer**

13. `CompareViewer` + `DualMapCompare` (shared View — simplest first) +
    `LinkedLayerBrowser`/`useCompareSelection`/`layer-pairing.ts` +
    `CompareTimeSlider`/`compare-timeline.ts` (epoch-keyed union, per-source
    raw TIME). Unit tests: layer-pairing (full/partial/zero overlap, levels),
    compare-timeline (union, mixed string forms → one epoch, raw round-trip).
14. `SingleMapCompare` + `SwipeController` (clip + divider, `role="slider"`
    a11y).
15. Secondary modes: `FlickerController`, `BlendController`,
    `SpyGlassController` — one small file + one toolbar entry each
    (evaluation/removal = delete file + entry). Integration test
    `compare-viewer.test.tsx`: mode switcher, availability chips, linked
    add-to-both, zero-overlap auto-unlink notice, union count + gap badge,
    swipe slider a11y value change, flicker `aria-pressed`.

**Phase 5 — external data**

16. WMS-URL form in the picker (GetCapabilities probe validation,
    CORS/unreachable/parse error copy); per-source `rebaseUrls` flag
    (`rebaseLensUrl` only for lens-backed sources).
17. **Stretch (defer if it grows):** GeoJSON context overlay — file input →
    `ol/format/GeoJSON` → shared `VectorSource`, one `VectorLayer` per map, z
    between stacks and reference overlay, simple default style, remove chip.

**Phase 6 — polish**

18. Per-source pinned legends (`${sourceId}:${name}` keys), editable panel
    labels, PNG export for single-map modes (reuse `exportMapPng`; swipe clip
    baked in = WYSIWYG); side-by-side export (compose two canvases + labels)
    as nice-to-have; optional e2e smoke (`tests/e2e/compare.spec.ts`, must
    pass both Playwright configs).

## Manual testing per phase

Dev layout: 3 terminals (uvicorn backend, cascade gateway, `npm run dev`);
`ulimit -n 65536` in each tab. Real GRIB directories live in
`~/.fiab/jobs_output/` (e.g. `gribdir/`, `4af24cc6-…_1/`, `c6e1901e-…_4/`,
each with `2t.grib2`, `msl.grib2`, …).

- **After Phase 1:** existing viewer must behave identically — open a stored
  output's WMS viewer from a run detail page and from the Active Lenses card;
  add/remove/reorder layers, scrub time, change opacity, export PNG.
- **After Phase 2:** ⇄ buttons appear on stored outputs + active lens rows;
  adding shows the Compare tab with count badge; state survives reload.
- **After Phase 3:** open /compare → add two host-path sources pointing at two
  `~/.fiab/jobs_output` run dirs → both panels auto-start lenses and show the
  single-source viewer each; Stop lens servers works; shared URL hydrates in a
  fresh tab.
- **After Phase 4:** swipe divider, side-by-side sync, flicker/spy/blend on the
  same pair; time slider unions valid times; availability badge on gaps.
- **After Phase 5:** paste another lens's WMS URL as external source (simulates
  a foreign server); bogus URL → clear error.

## Verification (end-to-end, real data)

1. Two host-path sources from `~/.fiab/jobs_output` → compare `2t`/`msl` in
   side-by-side and swipe; scrub time; verify per-source TIME strings in the
   network tab.
2. Run detail → Add to comparison → badge → Compare → panel auto-starts (or
   reuses) a lens — verify no duplicate lens for the same path.
3. Shared URL in a fresh tab hydrates entries.
4. Flicker shows instant swap with no new network requests.
5. `npm run validate:fix` green (fix + check + unit/integration + e2e + build).

## Backend follow-ups (report, don't build)

- Lens instances don't echo `run_id`/`dataset_id` → matching running lenses to
  outputs needs N head-fetches; echoing them would remove the join.
- `RunOutputMetadata` lacks base/valid time and sink-type info → basket shows
  `created_at` only; times come from GetCapabilities.
- No "has GRIB outputs" filter on `/run/list` → picker scans page 1 only.
- External WMS in **prod**: CSP allowlists loopback lens ports only →
  arbitrary external domains need a CSP config knob or a backend same-origin
  WMS proxy (known deferred item). v1 documents the limitation; dev works.
- Browser file upload → lens (deferred v1 decision).

## Top risks

- **Regressing the single-lens viewer** → characterization tests before
  touching it; extraction commits individually revertible; `zBase: 0` keeps z
  math identical.
- **Clip listeners vs. layer reconciliation** → `revision` contract; effect
  cleanup must `layer.un(...)` or clips leak into other modes.
- **Time string mismatches across servers** → epoch-keyed timeline; never send
  a normalized string a server didn't advertise.
- **Canvas invariants** (`className`-less layers, `hidpi:false, ratio:1`) →
  documented in `ol-layers.ts`; breaking them silently kills swipe clipping
  and PNG export.
