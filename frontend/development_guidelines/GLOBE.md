# 3D globe (Visualise)

The globe is an explicit mode of the Visualise viewer. Flat maps stay OpenLayers; the globe is
MapLibre GL (camera, gestures, Carto basemap) with our own WebGL2 layer for the WMS data.
Everything lives in `src/features/viewer/globe/`.

## Why our own data layer

MapLibre draws the globe; we add one custom layer (its extension point) for the WMS data:

- MapLibre's raster sources want Web Mercator tiles: tiles cut server-drawn labels and wind
  barbs, and Mercator has no poles. We draw one EPSG:4326 image per view, poles included.
- The bend starts from the OpenLayers flat map in any flat projection, and every panel shows one
  instant; both need control a built-in source does not give.
- Cesium (large, tiled, replaces Carto) and three.js (still needs these shaders, loses Carto's
  labels) were weighed and rejected.

## Modules

| Module                               | Role                                                                        |
|--------------------------------------|-----------------------------------------------------------------------------|
| `useGlobeViewer.ts`                  | GeoViewer's entry point: support check, warm-up, pan/zoom bridges           |
| `useGlobeMode.ts`                    | Phases `flat -> entering -> globe -> leaving -> flat`; either bend reverses |
| `webgl-support.ts`                   | Hardware WebGL2 check; software renderers are refused                       |
| `GlobeView.tsx`, `LazyGlobeView.tsx` | Overlay with one panel per source; lazy engine boundary                     |
| `GlobePanel.tsx`, `value-store.ts`   | One panel: engine, chrome, readout, loupe; pointer values off React state   |
| `engine.ts`, `engine-entry.ts`       | Engine seam (types) and the lazily loaded MapLibre engine                   |
| `MapLibreGlobeEngine.ts`             | MapLibre lifecycle, camera, Carto, and the bend (`bendTo`)                  |
| `globe-layer-specs.ts`               | Flat layer stack and basemap choice -> globe layer and basemap specs        |
| `globe-content.ts`                   | Facade: texture store + renderer for the host WebGL2 context                |
| `globe-plan.ts`                      | Pure: which GetMaps a layer needs and how large                             |
| `globe-textures.ts`                  | State: loading and shown images, GPU budget, failure policy                 |
| `globe-render.ts`                    | GL: programs, uploads, the draw pass, outline, flat-map seed                |
| `webgl/`                             | Shaders, meshes, texture creation                                           |
| `globe-camera.ts`, `sphere-math.ts`  | Camera maths and the OL handoff                                             |
| `animation.ts`                       | Easing and the frame-driven tween behind every bend and fade                |

## The bend

One number per panel, `t` in [0, 1]: 0 is the flat map's own frame, 1 the settled globe.
Entering, leaving and reversing all move `t` towards 0 or 1 (`bendTo`), with one easing.

While 0 < t < 1 our layer draws every pixel of geometry; MapLibre holds a fixed globe camera and
Carto sits out (its opacity comes from one global-state factor, faded to 0):

- Each vertex moves in a straight line on screen, from its flat position (orthographic flat
  matrix) to its globe position, emitted at the sphere's `w`: exact at both ends,
  perspective-correct at 1.
- The flat position uses the world copy nearest the flat camera; triangles across the cut
  between copies are skipped, so nothing sweeps across the view near the dateline.
- Back faces are culled: the whole sheet faces the viewer when flat, and the far hemisphere
  disappears as its triangles turn away (outline lines, which cannot be culled, fade instead).
  Latitudes the flat map does not show (Mercator beyond +/-85.05) fade in.
- Stand-ins for Carto: entering bends the flat map's own pixels (the seed, Carto and labels
  included); our outline shows under the data while Carto is faded.

After arrival Carto fades back in and the seed fades once the live images load. After an unbend
the overlay holds until the OL map under it has rendered, then fades.

The globe warms up hidden when the projection menu opens: it fetches no data until entered, and
it already has the chosen basemap (not the flat map's Outline fallback), so entering never
reloads MapLibre's style mid-bend.

## Images

`plan -> textures -> render`:

- `globe-plan.ts` owns every sizing rule: first and target scale; limits (ours 4096, the GPU's,
  the server's MaxWidth/MaxHeight); square pixels (SkinnyWMS letterboxes any other ratio); the
  visible region; the split into two GetMaps across 180; no view image when the world image is
  as sharp (always so around a pole).
- `globe-textures.ts` keeps per layer a world image and a view image with the params key each
  was fetched with. A failed first image of an instant hides the layer and is reported; a failed
  sharper copy keeps what is shown and backs off. `eachLayer` hands the renderer one instant
  per frame.
- `globe-render.ts` uploads and draws what the store hands it; it owns no loading state.

## Camera and basemap

- Zoom is neutral (centre ground m/px), measured from what MapLibre renders. Its range is mapped
  to MapLibre's zoom on every move: the ceiling at the current latitude, the floor (a globe
  radius) at the equator, because MapLibre applies `minZoom` as a globe size at any latitude but
  `maxZoom` as is.
- If Carto's style cannot load (offline, intranet), the engine falls back to the outline, toasts
  once, and tries Carto again only when the basemap choice changes. Our outline style is passed
  built, not through `transformStyle`: MapLibre defers that until the current style loads, and
  a failed style never does.
- A map that has not loaded after 10 s fails its mount; the panel hands back to the flat map.

## Invariants and their tests

| Invariant                                         | Test                                                             |
|---------------------------------------------------|------------------------------------------------------------------|
| One instant per frame; export waits for it        | `globe-registration` "after a time step", `globe-viewer` capture |
| Far side never over the near side while bending   | `globe-registration` "while bending"                             |
| Points move evenly on screen                      | `globe-registration` "while bending"                             |
| Nothing sweeps across the view (dateline in view) | `globe-registration` "while bending"                             |
| Square pixels, within every size limit            | `globe-plan.test`, `globe-registration`                          |
| Registration, seam, poles, budget, context loss   | `globe-registration`                                             |
| The warm globe already has the chosen basemap     | `globe-viewer` "warms the globe with the chosen basemap"         |

`tests/integration/features/viewer/globe-registration.test.ts` runs the real engine on WebGL in
Vitest browser mode against a mock WMS that renders whatever BBOX and size is asked.
`tests/e2e/globe.spec.ts` runs on the `globe` Playwright project (full Chromium, hardware GL);
run it with `VITE_PORT=3100` while a dev server holds :3000.

## Known limits

- SkinnyWMS/Magics draws EPSG:3857 only to about 83N/79S, and EPSG:4326 only to the model
  grid's first latitude, so a small disc shows at each pole.
- Server-drawn symbols (wind barbs, labels) are squeezed east-west towards the poles on the
  globe; the projection menu says so.
