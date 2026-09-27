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
import { globeMinZoom, zoomFromGroundMpp } from './globe-camera'
import {
  applyFlatUniforms,
  createGlobeContent,
  drawCanvasViewport,
  easeInOutCubic,
  tween,
} from './globe-content'
import { EARTH_RADIUS_M, MERCATOR_WORLD_M } from './sphere-math'
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
  let basemap: GlobeBasemapSpec | null = null
  /** Vector style currently loaded (null = the empty globe style). */
  let styleUrl: string | null = null
  let styleLayers: Array<StyleLayerState> = []
  let shownKey = ''
  let attribution: AttributionControl | null = null
  /** Our clip-space bend runs (non-Mercator flat); else MapLibre bends. */
  let ownBend = false
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
      // Data under the labels, as on the flat map.
      const labels = m.getStyle().layers.find((l) => l.type === 'symbol')
      if (!m.getLayer(layer.id)) m.addLayer(layer, labels?.id)
      styleLayers = m
        .getStyle()
        .layers.filter((l) => l.id !== layer.id)
        .map((l) => ({
          id: l.id,
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
    // MapLibre's basemap follows its own bend, not ours: outline then.
    const vector = wanted !== null && !ownBend
    const key = `${vector}|${basemap.theme}|${basemap.opacity}`
    if (key === shownKey) return
    shownKey = key
    content.setOutline(
      vector ? null : { theme: basemap.theme, opacity: basemap.opacity },
    )
    const f = basemap.opacity
    for (const l of styleLayers) {
      m.setLayoutProperty(l.id, 'visibility', vector ? l.visibility : 'none')
      for (const [prop, value] of l.paint) {
        const next = f === 1 ? value : scaleOpacity(value, f)
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

  function animate(durationMs: number, step: (p: number) => void) {
    animating = true
    setInteractive(false)
    syncBasemap()
    return tween(durationMs, (p) => {
      step(p)
      // Draw in this frame, not MapLibre's next one.
      map?.redraw()
    }).finally(() => {
      animating = false
      setInteractive(true)
      syncBasemap()
    })
  }

  const inverse = new Float64Array(16)
  const layer: CustomLayerInterface = {
    id: 'fiab-globe',
    type: 'custom',
    renderingMode: '3d',
    render: (gl, args) => {
      if (!content || !map) return
      const u = content.uniforms
      const pd = args.defaultProjectionData
      // mainMatrix projects the unit sphere while MapLibre renders a globe.
      u.sphereMatrix.set(pd.mainMatrix)
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
      content.draw(gl)
    },
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
        zoom: () => measuredZoom(m),
      })
      // Gestures carry the DOM event; resizes and jumps do not.
      m.on('move', (e) => {
        if (programmatic || animating || !e.originalEvent) return
        events.onCameraChange(cameraOf(m), 'user')
        content?.scheduleUpgrade()
      })
      m.on('webglcontextlost', () => events.onContextLost())
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
      m.addLayer(layer)
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

    getCamera: () => (map ? cameraOf(map) : { lon: 0, lat: 0, zoom: 1 }),

    setCamera: (cam) => {
      if (!map) return
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

    morphIn: (from, to, durationMs) => {
      const m = map
      if (!m || !content) return Promise.resolve()
      const u = content.uniforms
      const settle = () => {
        wheelLockUntil = performance.now() + WHEEL_SETTLE_MS
        map?.scrollZoom.disable()
        settleWheel()
        content?.scheduleUpgrade()
      }
      if (from.projection !== 'merc') {
        // MapLibre has no equirectangular: our bend over its globe.
        ownBend = true
        flat = from
        setGlobeness(m, 1)
        jumpTo(m, to)
        u.morph = 0
        return animate(durationMs, (p) => {
          u.morph = easeInOutCubic(p)
        }).then(() => {
          ownBend = false
          syncBasemap()
          settle()
        })
      }
      // MapLibre bends itself: starts as the OL Mercator frame.
      flat = null
      const minZoom = m.getMinZoom()
      m.setMinZoom(-2)
      const start = { ...from, zoom: mercatorZoom(from.resolution) }
      const end = { ...to, lon: nearLon(to.lon, from.lon), zoom: globeZoom(to) }
      setGlobeness(m, 0)
      place(m, start)
      return animate(durationMs, (p) => {
        const e = easeInOutCubic(p)
        setGlobeness(m, e)
        place(m, lerpCam(start, end, e))
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
      if (to.projection !== 'merc') {
        ownBend = true
        flat = to
        return animate(durationMs, (p) => {
          u.morph = 1 - easeInOutCubic(p)
        })
      }
      // Ends as the OL Mercator frame the handoff reveals.
      flat = null
      m.setMinZoom(-2)
      const c = m.getCenter()
      const start = { lon: c.lng, lat: c.lat, zoom: m.getZoom() }
      const end = {
        lon: nearLon(to.lon, c.lng),
        lat: to.lat,
        zoom: mercatorZoom(to.resolution),
      }
      return animate(durationMs, (p) => {
        const e = easeInOutCubic(p)
        setGlobeness(m, 1 - e)
        place(m, lerpCam(start, end, e))
      })
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
      content?.dispose()
      content = null
      map?.remove()
      map = null
      for (const fn of detach.splice(0)) fn()
    },
  }
}
