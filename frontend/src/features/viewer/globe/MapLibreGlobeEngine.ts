/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** MapLibre engine: MapLibre's globe camera, gestures and basemap; our data as a custom layer. */

import {
  AttributionControl,
  Map as MapLibreMap,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { GLOBE_ENGINE } from './engine-entry'
import {
  globeMinZoom,
  globenessForProgress,
  zoomFromGroundMpp,
} from './globe-camera'
import {
  applyFlatUniforms,
  createGlobeContent,
  drawCanvasViewport,
  easeInOutCubic,
  easeOutCubic,
  tween,
} from './globe-content'
import {
  EARTH_RADIUS_M,
  MERCATOR_WORLD_M,
  lonLatToMercatorUnit,
  lonLatToUnitSphere,
} from './sphere-math'
import { invertMat4 } from './webgl/gl'
import type { CustomLayerInterface } from 'maplibre-gl'
import type { GlobeContent } from './globe-content'
import type {
  FlatCamera,
  GlobeBasemapSpec,
  GlobeCamera,
  GlobeEngine,
} from './engine'

const MAX_ZOOM = GLOBE_ENGINE.maxZoom
/** The wheel gesture that bent the map in is not globe input. */
const WHEEL_SETTLE_MS = 400
/** Zoom to the target scale before wrapping, per zoom level (none at the same scale). */
const FLY_MS = 400
/** Longest hold of the seed image after the bend while live layers load. */
const SEED_HOLD_CAP_MS = 4000
const SEED_FADE_MS = 250
/** A context lost this long without a restore hands the panel back to the flat map. */
const RESTORE_WAIT_MS = 5000
const EMPTY_FLAT: FlatCamera = {
  projection: 'merc',
  lon: 0,
  lat: 0,
  resolution: 1,
}

// Same-origin module worker: the CSP has no blob: worker source.
setWorkerUrl(workerUrl)

type StyleSpecification = Exclude<
  Parameters<MapLibreMap['setStyle']>[0],
  string | null
>
type ProjectionSpecification = NonNullable<StyleSpecification['projection']>
type StateSpecification = NonNullable<StyleSpecification['state']>

/** Global-state key driving MapLibre's own Mercator → globe blend (0..1). */
const GLOBENESS = 'fiabGlobeness'
const D2R = Math.PI / 180

/** Projection blended by GLOBENESS, independent of zoom. */
const PROJECTION: ProjectionSpecification = {
  type: [
    'interpolate',
    ['linear'],
    ['number', ['global-state', GLOBENESS], 1],
    0,
    'mercator',
    1,
    'vertical-perspective',
  ] as unknown as ProjectionSpecification['type'],
}

const globenessState = (value: number): StateSpecification => ({
  [GLOBENESS]: { default: value },
})

/** Style with no sources: MapLibre supplies camera and projection only. */
const GLOBE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
  projection: PROJECTION,
  state: globenessState(1),
}

/** MapLibre Mercator zoom for an OL EPSG:3857 resolution. */
const mercatorZoom = (resolution: number) =>
  Math.log2(MERCATOR_WORLD_M / resolution / 512)

/** MapLibre zoom whose globe matches the neutral camera's centre scale. */
const globeZoom = (cam: GlobeCamera) =>
  cam.zoom -
  1 +
  Math.log2(Math.cos(cam.lat * D2R)) +
  Math.log2(EARTH_RADIUS_M / (MERCATOR_WORLD_M / (2 * Math.PI)))

interface MapLibreCam {
  lon: number
  lat: number
  zoom: number
}

/** `lon` shifted by whole turns to lie within 180° of `ref`. */
const nearLon = (lon: number, ref: number) =>
  ref + ((((lon - ref + 180) % 360) + 360) % 360) - 180

const lerpCam = (a: MapLibreCam, b: MapLibreCam, t: number): MapLibreCam => ({
  lon: a.lon + (b.lon - a.lon) * t,
  lat: a.lat + (b.lat - a.lat) * t,
  zoom: a.zoom + (b.zoom - a.zoom) * t,
})

type PaintProp = Parameters<MapLibreMap['getPaintProperty']>[1]
type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2]

/** Opacity paint properties per style layer type. */
const OPACITY_PROPS: Partial<Record<string, ReadonlyArray<PaintProp>>> = {
  background: ['background-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  raster: ['raster-opacity'],
  circle: ['circle-opacity'],
}

/** Opacity value × f; zoom curves stay top-level (scale their outputs). */
function scaleOpacity(value: unknown, f: number): unknown {
  if (value === undefined) return f
  if (typeof value === 'number') return value * f
  if (Array.isArray(value)) {
    const outputs = (from: number, odd: boolean) => [
      ...value.slice(0, from),
      ...value
        .slice(from)
        .map((v: unknown, i) =>
          (i % 2 === 1) === odd ? scaleOpacity(v, f) : v,
        ),
    ]
    if (value[0] === 'interpolate') return outputs(3, true)
    if (value[0] === 'step') return outputs(2, false)
    return ['*', value, f]
  }
  if (value && typeof value === 'object' && 'stops' in value) {
    const legacy = value as { stops: Array<[number, unknown]> }
    return {
      ...legacy,
      stops: legacy.stops.map(([z, v]) => [z, scaleOpacity(v, f)]),
    }
  }
  return value
}

interface StyleLayerState {
  id: string
  type: string
  visibility: 'visible' | 'none'
  paint: Array<[PaintProp, unknown]>
}

export function createMapLibreGlobeEngine(): GlobeEngine {
  let map: MapLibreMap | null = null
  let content: GlobeContent | null = null
  let container: HTMLElement | null = null
  let flat: FlatCamera | null = null
  let animating = false
  let programmatic = false
  let wheelLockUntil = 0
  let wheelTimer = 0
  let restoreTimer = 0
  let basemap: GlobeBasemapSpec | null = null
  /** Vector style currently loaded (null = the empty globe style). */
  let styleUrl: string | null = null
  let styleLayers: Array<StyleLayerState> = []
  let shownKey = ''
  let attribution: AttributionControl | null = null
  /** Our clip-space bend runs (non-Mercator flat); else MapLibre bends. */
  let ownBend = false
  /** Carto layers spike at the poles mid-bend: off while bending. */
  let bending = false
  let globeness = 1
  let styleReady = false
  const detach: Array<() => void> = []

  const size = (): [number, number] => [
    Math.max(1, container?.clientWidth ?? 1),
    Math.max(1, container?.clientHeight ?? 1),
  ]

  /** Neutral zoom from the rendered ground scale at the centre. */
  function measuredZoom(m: MapLibreMap): number {
    const c = m.getCenter()
    const lat = Math.min(89.99, c.lat + 0.01)
    const p0 = m.project(c)
    const p1 = m.project([c.lng, lat])
    const pxPerDeg = Math.hypot(p1.x - p0.x, p1.y - p0.y) / (lat - c.lat)
    return zoomFromGroundMpp((Math.PI * EARTH_RADIUS_M) / 180 / pxPerDeg)
  }

  function cameraOf(m: MapLibreMap): GlobeCamera {
    const c = m.getCenter()
    return { lon: c.lng, lat: c.lat, zoom: measuredZoom(m) }
  }

  function jumpTo(m: MapLibreMap, cam: GlobeCamera) {
    programmatic = true
    // MapLibre's zoom is 512 px based and latitude dependent: correct once.
    let zoom = cam.zoom - 1
    m.jumpTo({ center: [cam.lon, cam.lat], zoom })
    zoom += cam.zoom - measuredZoom(m)
    m.jumpTo({ zoom })
    programmatic = false
  }

  /** Ease to `cam`, measuring MapLibre's target through a silent jump. */
  function easeTo(m: MapLibreMap, cam: GlobeCamera, durationMs: number) {
    const start = { center: m.getCenter(), zoom: m.getZoom() }
    jumpTo(m, cam)
    const end = { center: m.getCenter(), zoom: m.getZoom() }
    programmatic = true
    m.jumpTo(start)
    programmatic = false
    m.once('moveend', () => content?.scheduleUpgrade())
    m.easeTo({ ...end, duration: durationMs })
  }

  /** MapLibre's own Mercator (0) → globe (1) blend. */
  function setGlobeness(m: MapLibreMap, value: number) {
    globeness = value
    if (styleReady) m.setGlobalStateProperty(GLOBENESS, value)
  }

  function place(m: MapLibreMap, cam: MapLibreCam) {
    programmatic = true
    m.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom })
    programmatic = false
  }

  function setInteractive(on: boolean) {
    if (!map) return
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ]
    for (const h of handlers) {
      if (on) h.enable()
      else h.disable()
    }
    if (on) map.touchZoomRotate.disableRotation()
  }

  /** Re-enable wheel zoom once the gesture that bent the map in pauses. */
  function settleWheel() {
    window.clearTimeout(wheelTimer)
    const wait = wheelLockUntil - performance.now()
    if (wait > 0) {
      wheelTimer = window.setTimeout(settleWheel, wait)
      return
    }
    map?.scrollZoom.enable()
  }

  function loadStyle(url: string | null) {
    const m = map
    if (!m) return
    styleUrl = url
    styleLayers = []
    shownKey = ''
    styleReady = false
    m.setStyle(url ?? GLOBE_STYLE, {
      diff: false,
      transformStyle: (_prev, next) => ({
        ...next,
        projection: PROJECTION,
        state: { ...next.state, ...globenessState(globeness) },
      }),
    })
    m.once('style.load', () => {
      if (map !== m || styleUrl !== url) return
      styleReady = true
      setGlobeness(m, globeness)
      addLayers(m)
      styleLayers = m
        .getStyle()
        .layers.filter((l) => l.id !== layer.id)
        .map((l) => ({
          id: l.id,
          type: l.type,
          visibility:
            m.getLayoutProperty(l.id, 'visibility') === 'none'
              ? 'none'
              : 'visible',
          paint: (OPACITY_PROPS[l.type] ?? []).map(
            (prop): [PaintProp, unknown] => [
              prop,
              m.getPaintProperty(l.id, prop),
            ],
          ),
        }))
      syncBasemap()
    })
  }

  function syncBasemap() {
    const m = map
    if (!m || !content || !basemap) return
    const wanted =
      basemap.kind === 'vector' && basemap.styleUrl ? basemap.styleUrl : null
    if (wanted !== styleUrl) return loadStyle(wanted)
    if (wanted && styleLayers.length === 0) return
    content.setDecoration(basemap.kind === 'wms' ? basemap.layers : [])
    // MapLibre's basemap follows its own bend, not ours: outline then.
    const vector = wanted !== null && !ownBend
    const key = `${vector}|${basemap.kind}|${basemap.theme}|${basemap.opacity}|${bending}`
    if (key === shownKey) return
    shownKey = key
    content.setOutline(
      vector || basemap.kind === 'wms'
        ? null
        : { theme: basemap.theme, opacity: basemap.opacity },
    )
    const f = basemap.opacity
    for (const l of styleLayers) {
      m.setLayoutProperty(l.id, 'visibility', vector ? l.visibility : 'none')
      const lf = bending ? 0 : f
      for (const [prop, value] of l.paint) {
        const next = lf === 1 ? value : scaleOpacity(value, lf)
        m.setPaintProperty(l.id, prop, next as PaintValue)
      }
    }
    if (vector && !attribution) {
      attribution = new AttributionControl({ compact: true })
      m.addControl(attribution)
    } else if (!vector && attribution) {
      m.removeControl(attribution)
      attribution = null
    }
  }

  /** `holdBasemap`: Carto off while bending (the seed stands in for it on entry). */
  function animate(
    durationMs: number,
    step: (p: number) => void,
    holdBasemap = true,
  ) {
    animating = true
    bending = holdBasemap
    setInteractive(false)
    syncBasemap()
    return tween(durationMs, (p) => {
      step(p)
      if (bending && p >= 0.97) {
        bending = false
        syncBasemap()
      }
      // Draw in this frame, not MapLibre's next one.
      map?.redraw()
    }).finally(() => {
      animating = false
      bending = false
      setInteractive(true)
      syncBasemap()
    })
  }

  const inverse = new Float64Array(16)
  // The last globe and Mercator clip matrices MapLibre drew with.
  const lastSphere = new Float64Array(16)
  const lastFlat = new Float64Array(16)
  let haveMatrices = false

  /** Globeness showing `cam`'s centre `s` of the way from globe to flat on screen. */
  function globenessAt(s: number, cam: MapLibreCam): number {
    if (!haveMatrices) return 1 - s
    const [x, y, z] = lonLatToUnitSphere(cam.lon, cam.lat)
    const [mx, my] = lonLatToMercatorUnit(cam.lon, cam.lat)
    const S = lastSphere
    const F = lastFlat
    const ws = S[3] * x + S[7] * y + S[11] * z + S[15]
    const wf = F[3] * mx + F[7] * my + F[15]
    return ws > 0 && wf > 0 ? globenessForProgress(s, wf / ws) : 1 - s
  }
  type RenderArgs = Parameters<NonNullable<CustomLayerInterface['render']>>[1]
  function applyProjection(pd: RenderArgs['defaultProjectionData']) {
    if (!content) return
    const u = content.uniforms
    // mainMatrix projects the unit sphere while MapLibre renders a globe.
    u.sphereMatrix.set(pd.mainMatrix)
    if (pd.projectionTransition > 0) {
      lastSphere.set(pd.mainMatrix)
      lastFlat.set(pd.fallbackMatrix)
      haveMatrices = true
    }
    if (!ownBend || pd.projectionTransition > 0) {
      // Eye = the point sent to w = 0: column z of the inverse.
      const inv = invertMat4(pd.mainMatrix, inverse)
      if (inv && inv[11] !== 0) {
        u.camModel = [inv[8] / inv[11], inv[9] / inv[11], inv[10] / inv[11]]
      }
    }
    if (ownBend && flat) {
      const [w, h] = size()
      applyFlatUniforms(u, flat, w, h)
    } else {
      // Follow MapLibre's blend: fallbackMatrix takes Mercator 0..1.
      u.flatKind = 1
      u.flatMatrix.set(pd.fallbackMatrix)
      u.morph = pd.projectionTransition
    }
  }
  const layer: CustomLayerInterface = {
    id: 'fiab-globe',
    type: 'custom',
    renderingMode: '3d',
    render: (gl, args) => {
      if (!content || !map) return
      applyProjection(args.defaultProjectionData)
      content.draw(gl)
    },
  }
  /** The flat map's pixels, above everything, until the live globe has loaded. */
  const seedLayer: CustomLayerInterface = {
    id: 'fiab-globe-seed',
    type: 'custom',
    renderingMode: '3d',
    render: (gl, args) => {
      if (!content || !map) return
      applyProjection(args.defaultProjectionData)
      content.drawSeed(gl)
    },
  }
  function addLayers(m: MapLibreMap) {
    // Data under the trailing label band; roads and borders sit above early labels.
    const layers = m.getStyle().layers
    let band = layers.length
    while (band > 0 && layers[band - 1].type === 'symbol') band--
    if (!m.getLayer(layer.id)) m.addLayer(layer, layers[band]?.id)
    if (!m.getLayer(seedLayer.id)) m.addLayer(seedLayer)
  }

  /** Hold the seed until the live layers and tiles are in, then fade it. */
  function releaseSeed() {
    const c = content
    if (!c) return
    const loaded = Promise.all([
      c.whenLoaded(),
      new Promise<void>((resolve) => {
        if (!map || map.loaded()) resolve()
        else map.once('idle', () => resolve())
      }),
    ])
    void Promise.race([
      loaded,
      new Promise<void>((r) => window.setTimeout(r, SEED_HOLD_CAP_MS)),
    ])
      .then(() =>
        tween(SEED_FADE_MS, (p) => {
          content?.setSeedOpacity(1 - p)
          map?.triggerRepaint()
        }),
      )
      .then(() => {
        if (content && flat === null) content.setSeed(null, EMPTY_FLAT, 1, 1)
      })
  }

  return {
    mount: async (el, events) => {
      container = el
      // MapLibre makes its container position: relative — give it a filled child.
      const host = document.createElement('div')
      host.style.cssText = 'width:100%;height:100%'
      el.appendChild(host)
      detach.push(() => host.remove())
      const m = new MapLibreMap({
        container: host,
        style: GLOBE_STYLE,
        attributionControl: false,
        renderWorldCopies: false,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        keyboard: false,
        boxZoom: false,
        canvasContextAttributes: { antialias: true },
      })
      map = m
      m.touchZoomRotate.disableRotation()
      m.getCanvas().dataset.testid = 'globe-canvas'
      content = createGlobeContent({
        events,
        invalidate: () => m.triggerRepaint(),
        view: () => {
          const [width, height] = size()
          return { ...cameraOf(m), width, height }
        },
      })
      // Gestures carry the DOM event; resizes and jumps do not.
      m.on('move', (e) => {
        if (programmatic || animating || !e.originalEvent) return
        events.onCameraChange(cameraOf(m), 'user')
        content?.scheduleUpgrade()
      })
      m.on('webglcontextlost', () => {
        styleReady = false
        window.clearTimeout(restoreTimer)
        restoreTimer = window.setTimeout(
          () => events.onContextLost(),
          RESTORE_WAIT_MS,
        )
      })
      // MapLibre restores its own layers; custom layers, state and textures are ours.
      m.on('webglcontextrestored', () => {
        window.clearTimeout(restoreTimer)
        content?.reset()
        loadStyle(styleUrl)
      })
      const onWheel = () => {
        if (performance.now() < wheelLockUntil) {
          wheelLockUntil = performance.now() + 150
        }
      }
      el.addEventListener('wheel', onWheel, { capture: true, passive: true })
      detach.push(() =>
        el.removeEventListener('wheel', onWheel, { capture: true }),
      )
      await new Promise<void>((resolve) => m.once('load', () => resolve()))
      styleReady = true
      addLayers(m)
      const [w, h] = size()
      // Bound the neutral zoom via MapLibre's zoom at the current latitude.
      const offset = measuredZoom(m) - m.getZoom()
      m.setMaxZoom(MAX_ZOOM - offset)
      // MapLibre's zoom floor is -2.
      m.setMinZoom(Math.max(-2, globeMinZoom(w, h) - offset))
    },

    setLayers: (specs) => content?.setLayers(specs),

    setBasemap: (spec) => {
      basemap = spec
      syncBasemap()
    },

    setLive: (on) => content?.setLive(on),

    getCamera: () => (map ? cameraOf(map) : { lon: 0, lat: 0, zoom: 1 }),

    setCamera: (cam, move) => {
      if (!map) return
      if (move?.easeMs) return easeTo(map, cam, move.easeMs)
      jumpTo(map, cam)
      content?.scheduleUpgrade()
    },

    // Data and basemap tiles: the bend shows both from its first frame.
    whenLoaded: () =>
      Promise.all([
        content?.whenLoaded(),
        new Promise<void>((resolve) => {
          if (!map || map.loaded()) resolve()
          else map.once('idle', () => resolve())
        }),
      ]).then(() => undefined),

    morphIn: (from, to, durationMs, seed) => {
      const m = map
      if (!m || !content) return Promise.resolve()
      const u = content.uniforms
      u.polarCap = 1
      // Entering wakes a warm globe, whatever React's effect timing.
      content.setLive(true)
      const [sw, sh] = size()
      content.setSeed(seed, from, sw, sh)
      const settle = () => {
        wheelLockUntil = performance.now() + WHEEL_SETTLE_MS
        map?.scrollZoom.disable()
        settleWheel()
        content?.scheduleUpgrade()
        syncBasemap()
        releaseSeed()
      }
      if (from.projection !== 'merc') {
        // MapLibre has no equirectangular: our bend over its globe.
        ownBend = true
        flat = from
        setGlobeness(m, 1)
        jumpTo(m, to)
        u.morph = 0
        return animate(durationMs, (p) => {
          u.morph = easeOutCubic(p)
        }).then(() => {
          ownBend = false
          flat = null
          syncBasemap()
          settle()
        })
      }
      // Zoom from the OL Mercator frame to the target scale if it differs, then wrap at fixed camera.
      flat = null
      const minZoom = m.getMinZoom()
      m.setMinZoom(-2)
      const start = { ...from, zoom: mercatorZoom(from.resolution) }
      const end = { ...to, lon: nearLon(to.lon, from.lon), zoom: globeZoom(to) }
      const mid = { ...start, zoom: end.zoom }
      const fly =
        durationMs > 0
          ? FLY_MS * Math.min(1, Math.abs(end.zoom - start.zoom))
          : 0
      const total = durationMs > 0 ? fly + durationMs : 0
      setGlobeness(m, 0)
      place(m, start)
      return animate(total, (p) => {
        const t = p * total
        if (t < fly) {
          place(m, lerpCam(start, mid, easeInOutCubic(t / fly)))
          return
        }
        const e =
          total > 0 ? easeOutCubic(Math.min(1, (t - fly) / durationMs)) : 1
        setGlobeness(m, e)
        place(m, lerpCam(mid, end, e))
      }).then(() => {
        jumpTo(m, to)
        m.setMinZoom(minZoom)
        settle()
      })
    },

    morphOut: (to, durationMs) => {
      const m = map
      if (!m || !content) return Promise.resolve()
      const u = content.uniforms
      content.setSeed(null, to, 1, 1)
      if (to.projection !== 'merc') {
        ownBend = true
        flat = to
        return animate(durationMs, (p) => {
          u.morph = 1 - easeInOutCubic(p)
        })
      }
      // Ends as the OL Mercator frame the handoff reveals; Carto and its labels unroll too.
      flat = null
      u.polarCap = 0
      m.setMinZoom(-2)
      const c = m.getCenter()
      const start = { lon: c.lng, lat: c.lat, zoom: m.getZoom() }
      const end = {
        lon: nearLon(to.lon, c.lng),
        lat: to.lat,
        zoom: mercatorZoom(to.resolution),
      }
      return animate(
        durationMs,
        (p) => {
          // Eased on screen, not in clip space, so the unroll spans the whole move.
          const s = easeInOutCubic(p)
          const cam = lerpCam(start, end, s)
          setGlobeness(m, globenessAt(s, cam))
          place(m, cam)
        },
        false,
      )
    },

    pick: (px) => {
      if (!map || content?.uniforms.morph !== 1) return null
      const ll = map.unproject([px[0], px[1]])
      // Off the globe MapLibre clamps to the horizon: reject that.
      const back = map.project(ll)
      return Math.hypot(back.x - px[0], back.y - px[1]) < 1.5
        ? { lon: ll.lng, lat: ll.lat }
        : null
    },

    capture: () => {
      map?.redraw()
      const src = map!.getCanvas()
      const out = document.createElement('canvas')
      out.width = src.width
      out.height = src.height
      out.getContext('2d')?.drawImage(src, 0, 0)
      return out
    },

    drawViewport: (ctx, opts) => {
      if (!map) return
      map.redraw()
      drawCanvasViewport(map.getCanvas(), size()[0], ctx, opts)
    },

    size,

    destroy: () => {
      window.clearTimeout(wheelTimer)
      window.clearTimeout(restoreTimer)
      content?.dispose()
      content = null
      map?.remove()
      map = null
      for (const fn of detach.splice(0)) fn()
    },
  }
}
