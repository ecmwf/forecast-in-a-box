/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** MapLibre engine: MapLibre's globe camera, gestures and basemap; our data, and every bend, as a custom layer. */

import {
  AttributionControl,
  Map as MapLibreMap,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { GLOBE_ENGINE } from './engine-entry'
import { globeMinZoom, zoomFromGroundMpp } from './globe-camera'
import { easeInOutCubic, tween } from './animation'
import { createGlobeContent } from './globe-content'
import { applyFlatUniforms } from './globe-render'
import { EARTH_RADIUS_M } from './sphere-math'
import { invertMat4 } from './webgl/gl'
import type { CustomLayerInterface } from 'maplibre-gl'
import type { GlobeContent } from './globe-content'
import type {
  FlatCamera,
  GlobeBasemapSpec,
  GlobeCamera,
  GlobeEngine,
  ViewportDraw,
} from './engine'

const MAX_ZOOM = GLOBE_ENGINE.maxZoom
const MAPLIBRE_MIN_ZOOM = -2
/** Longest hold of the seed image after the bend while live layers load. */
const SEED_HOLD_CAP_MS = 4000
const SEED_FADE_MS = 250
/** Carto fading out for a bend (our outline stands in) and back in after it. */
const CARTO_FADE_MS = 250
/** Shortest reversal of a bend in flight. */
const MIN_TAKEOVER_MS = 200
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
type LayerSpecification = StyleSpecification['layers'][number]
type ProjectionSpecification = NonNullable<StyleSpecification['projection']>

/** MapLibre only ever shows a globe; the bends are ours. */
const PROJECTION: ProjectionSpecification = { type: 'vertical-perspective' }

/** Global-state key scaling every Carto layer's opacity (basemap opacity x fade). */
const BASEMAP_OPACITY = 'fiabBasemapOpacity'
const BASEMAP_FACTOR = ['number', ['global-state', BASEMAP_OPACITY], 1]

/** Style with no sources: MapLibre supplies camera and projection only. */
const GLOBE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
  projection: PROJECTION,
}

/** Opacity paint properties per style layer type. */
const OPACITY_PROPS: Partial<Record<string, ReadonlyArray<string>>> = {
  background: ['background-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  raster: ['raster-opacity'],
  circle: ['circle-opacity'],
}

/** Opacity x `f`; zoom curves must stay top-level, so their outputs are scaled. */
function scaleOpacity(value: unknown, f: unknown): unknown {
  if (value === undefined) return f
  if (typeof value === 'number') return ['*', value, f]
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
  // Legacy zoom functions cannot hold an expression: rewrite them as one.
  if (value && typeof value === 'object' && !('property' in value)) {
    const fn = value as {
      stops?: Array<[number, unknown]>
      base?: number
      type?: string
    }
    if (!fn.stops?.length) return value
    const stops = fn.stops.map(([z, v]) => [z, scaleOpacity(v, f)] as const)
    if (fn.type === 'interval') {
      return ['step', ['zoom'], stops[0][1], ...stops.slice(1).flat()]
    }
    const curve =
      fn.base && fn.base !== 1 ? ['exponential', fn.base] : ['linear']
    return ['interpolate', curve, ['zoom'], ...stops.flat()]
  }
  return value
}

/** A style layer whose opacity follows the basemap factor. */
function withBasemapOpacity(layer: LayerSpecification): LayerSpecification {
  const props = OPACITY_PROPS[layer.type]
  if (!props) return layer
  const paint: Record<string, unknown> = {
    ...('paint' in layer ? layer.paint : {}),
  }
  for (const prop of props) {
    paint[prop] = scaleOpacity(paint[prop], BASEMAP_FACTOR)
  }
  return { ...layer, paint }
}

/** Draw a WebGL canvas region (CSS px) into a 2D context, right after rendering. */
function drawCanvasViewport(
  src: HTMLCanvasElement,
  cssWidth: number,
  ctx: CanvasRenderingContext2D,
  { originX, originY, scale }: ViewportDraw,
): void {
  const k = scale / (src.width / cssWidth)
  ctx.setTransform(k, 0, 0, k, -originX * scale, -originY * scale)
  ctx.drawImage(src, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

export function createMapLibreGlobeEngine(): GlobeEngine {
  let map: MapLibreMap | null = null
  let content: GlobeContent | null = null
  let container: HTMLElement | null = null
  let basemap: GlobeBasemapSpec | null = null
  /** Vector style currently loaded (null = the empty globe style). */
  let styleUrl: string | null = null
  let styleReady = false
  let outlineKey = ''
  let attribution: AttributionControl | null = null
  /** The flat end of the bend (null on the settled globe). */
  let flat: FlatCamera | null = null
  /** The bend in flight; a new one takes over from where it is. */
  let animation: AbortController | null = null
  /** Carto's share of its opacity: 0 while bending, 1 settled. */
  let cartoShown = 1
  let cartoFade: AbortController | null = null
  /** MapLibre's zoom floor on the globe. */
  let globeFloor = MAPLIBRE_MIN_ZOOM
  let restoreTimer = 0
  const detach: Array<() => void> = []
  const inverse = new Float64Array(16)

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
    // MapLibre's zoom is 512 px based and latitude dependent: correct once.
    let zoom = cam.zoom - 1
    m.jumpTo({ center: [cam.lon, cam.lat], zoom })
    zoom += cam.zoom - measuredZoom(m)
    m.jumpTo({ zoom })
  }

  /** Ease to `cam`, measuring MapLibre's target through a silent jump. */
  function easeTo(m: MapLibreMap, cam: GlobeCamera, durationMs: number) {
    const start = { center: m.getCenter(), zoom: m.getZoom() }
    jumpTo(m, cam)
    const end = { center: m.getCenter(), zoom: m.getZoom() }
    m.jumpTo(start)
    m.once('moveend', () => content?.scheduleUpgrade())
    m.easeTo({ ...end, duration: durationMs })
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

  function loadStyle(url: string | null) {
    const m = map
    if (!m) return
    styleUrl = url
    styleReady = false
    m.setStyle(url ?? GLOBE_STYLE, {
      diff: false,
      transformStyle: (_prev, next) => ({
        ...next,
        projection: PROJECTION,
        state: {
          ...next.state,
          [BASEMAP_OPACITY]: { default: (basemap?.opacity ?? 1) * cartoShown },
        },
        layers: next.layers.map(withBasemapOpacity),
      }),
    })
    m.once('style.load', () => {
      if (map !== m || styleUrl !== url) return
      styleReady = true
      addLayers(m)
      syncBasemap()
    })
  }

  /** Carto at the chosen opacity when settled; while it sits out a bend, our outline stands in. */
  function applyBasemapOpacity() {
    if (!map || !content || !basemap) return
    const vector = styleUrl !== null
    if (vector && styleReady) {
      map.setGlobalStateProperty(BASEMAP_OPACITY, basemap.opacity * cartoShown)
    }
    content.setOutlineOpacity(vector ? 1 - cartoShown : 1)
    map.triggerRepaint()
  }

  function fadeCarto(to: number) {
    cartoFade?.abort()
    const controller = new AbortController()
    cartoFade = controller
    const from = cartoShown
    void tween(
      CARTO_FADE_MS * Math.abs(to - from),
      (p) => {
        cartoShown = from + (to - from) * p
        applyBasemapOpacity()
      },
      controller.signal,
    )
  }

  function syncBasemap() {
    const m = map
    if (!m || !content || !basemap) return
    const wanted =
      basemap.kind === 'vector' && basemap.styleUrl ? basemap.styleUrl : null
    if (wanted !== styleUrl) return loadStyle(wanted)
    content.setDecoration(basemap.kind === 'wms' ? basemap.layers : [])
    // The outline is the basemap, or Carto's stand-in while bending.
    const key = `${basemap.kind}|${basemap.theme}|${basemap.opacity}`
    if (key !== outlineKey) {
      outlineKey = key
      content.setOutline(
        basemap.kind === 'wms'
          ? null
          : { theme: basemap.theme, opacity: basemap.opacity },
      )
    }
    applyBasemapOpacity()
    const vector = wanted !== null
    if (vector && !attribution) {
      attribution = new AttributionControl({ compact: true })
      m.addControl(attribution)
    } else if (!vector && attribution) {
      m.removeControl(attribution)
      attribution = null
    }
  }

  /** Move the bend from where it is to `target` (0 = flat, 1 = globe); Carto sits it out. */
  function bendTo(target: 0 | 1, durationMs: number): Promise<boolean> {
    const u = content!.uniforms
    const from = u.t
    animation?.abort()
    const controller = new AbortController()
    animation = controller
    setInteractive(false)
    fadeCarto(0)
    const distance = Math.abs(target - from)
    const ms =
      durationMs > 0 && distance > 0
        ? Math.max(durationMs * distance, MIN_TAKEOVER_MS)
        : 0
    return tween(
      ms,
      (p) => {
        u.t = from + (target - from) * easeInOutCubic(p)
        // Draw in this frame, not MapLibre's next one.
        map?.redraw()
      },
      controller.signal,
    ).then((done) => {
      // Taken over: the newer bend owns the state now.
      if (animation !== controller) return false
      animation = null
      return done
    })
  }

  /** Settled on the globe: exact camera, gestures, sharp textures, Carto back, the seed let go. */
  function arrive(m: MapLibreMap, to: GlobeCamera) {
    flat = null
    jumpTo(m, to)
    setInteractive(true)
    fadeCarto(1)
    content?.scheduleUpgrade()
    releaseSeed()
  }

  type RenderArgs = Parameters<NonNullable<CustomLayerInterface['render']>>[1]
  function applyProjection(pd: RenderArgs['defaultProjectionData']) {
    if (!content) return
    const u = content.uniforms
    u.sphereMatrix.set(pd.mainMatrix)
    // Eye = the point sent to w = 0: column z of the inverse.
    const inv = invertMat4(pd.mainMatrix, inverse)
    if (inv && inv[11] !== 0) {
      u.camModel[0] = inv[8] / inv[11]
      u.camModel[1] = inv[9] / inv[11]
      u.camModel[2] = inv[10] / inv[11]
    }
    if (flat) {
      const [w, h] = size()
      applyFlatUniforms(u, flat, w, h)
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
      const canvas = m.getCanvas()
      canvas.dataset.testid = 'globe-canvas'
      // No keyboard handler: the host's labelled panel is the region, not a "Map" tab stop.
      canvas.tabIndex = -1
      canvas.removeAttribute('role')
      canvas.removeAttribute('aria-label')
      content = createGlobeContent({
        events,
        invalidate: () => m.triggerRepaint(),
        view: () => {
          const [width, height] = size()
          return { ...cameraOf(m), width, height }
        },
      })
      // Gestures carry the DOM event; programmatic moves and resizes do not.
      m.on('move', (e) => {
        if (!e.originalEvent) return
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
      await new Promise<void>((resolve) => m.once('load', () => resolve()))
      styleReady = true
      addLayers(m)
      const [w, h] = size()
      // Bound the neutral zoom via MapLibre's zoom at the current latitude.
      const offset = measuredZoom(m) - m.getZoom()
      m.setMaxZoom(MAX_ZOOM - offset)
      globeFloor = Math.max(MAPLIBRE_MIN_ZOOM, globeMinZoom(w, h) - offset)
      m.setMinZoom(globeFloor)
    },

    setLayers: (specs) => content?.setLayers(specs),

    setBasemap: (spec) => {
      basemap = spec
      syncBasemap()
    },

    setLive: (on) => {
      content?.setLive(on)
      if (on || !map || !content) return
      // Hidden again: the next entry starts afresh from the flat map.
      animation?.abort()
      animation = null
      cartoFade?.abort()
      cartoShown = 1
      flat = null
      content.uniforms.t = 1
      content.setSeed(null, EMPTY_FLAT, 1, 1)
      setInteractive(true)
      applyBasemapOpacity()
    },

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
      // Wake a warm globe (whatever React's timing); the camera is final, so fetch sharp now.
      content.setLive(true)
      content.upgradeNow()
      // A fresh entry starts from the flat map's own frame; a reversal from wherever the bend is.
      if (!animation && content.uniforms.t === 1) {
        flat = from
        const [w, h] = size()
        content.setSeed(seed, from, w, h)
        jumpTo(m, to)
        content.uniforms.t = 0
      }
      return bendTo(1, durationMs).then((done) => {
        if (done) arrive(m, to)
      })
    },

    morphOut: (to, durationMs) => {
      const m = map
      if (!m || !content) return Promise.resolve()
      // Mid-entry the flat map's own pixels are still up: they unbend back as they came.
      if (!animation) content.setSeed(null, EMPTY_FLAT, 1, 1)
      flat = to
      return bendTo(0, durationMs).then(() => undefined)
    },

    pick: (px) => {
      if (!map || content?.uniforms.t !== 1) return null
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
      animation?.abort()
      cartoFade?.abort()
      window.clearTimeout(restoreTimer)
      content?.dispose()
      content = null
      map?.remove()
      map = null
      for (const fn of detach.splice(0)) fn()
    },
  }
}
