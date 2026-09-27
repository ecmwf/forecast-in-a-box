/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe scene content (layer textures, outline lines) drawn into a host WebGL2 context. */

import { flatClipTransform, globeRadiusPx } from './globe-camera'
import {
  MERCATOR_WORLD_M,
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
} from './sphere-math'
import {
  layerRegion,
  regionGetMapUrl,
  regionScale,
  regionSize,
} from './globe-getmap'
import {
  geojsonLines,
  graticuleLines,
  linesGeometry,
  surfaceGeometry,
} from './webgl/geometry'
import {
  createMesh,
  createProgram,
  createTexture,
  deleteMesh,
  drawMesh,
} from './webgl/gl'
import {
  COLOR_FRAGMENT,
  COLOR_UNIFORMS,
  LAYER_FRAGMENT,
  LAYER_UNIFORMS,
  SHARED_UNIFORMS,
  VERTEX,
} from './webgl/shaders'
import type { Mesh, Program } from './webgl/gl'
import type { Geometry } from './webgl/geometry'
import type {
  FlatCamera,
  GlobeEngineEvents,
  GlobeLayerSpec,
  GlobeOutlineSpec,
  GlobeSeed,
  ViewportDraw,
} from './engine'
import { createLogger } from '@/lib/logger'
import { loadOutlineData, outlinePalette } from '@/lib/map/ol-outline'

const log = createLogger('globe')

/** First request per layer at most this wide, then upgraded to on-screen detail. */
const FIRST_SIDE = 1024
const MAX_SIDE = 4096
/** Refetch when the wanted detail beats the shown one by this factor. */
const UPGRADE_FACTOR = 1.25
const UPGRADE_IDLE_MS = 300

type Vec4 = [number, number, number, number]

const BASE_COLOR: Record<'light' | 'dark', Vec4> = {
  light: [0.87, 0.9, 0.94, 1],
  dark: [0.12, 0.16, 0.23, 1],
}

/** Uniforms every draw shares; matrices column-major. */
export interface MorphUniforms {
  /** Flat unit world → clip. */
  flatMatrix: Float32Array
  /** Unit sphere → clip. */
  sphereMatrix: Float32Array
  /** 0 = flat, 1 = globe. */
  morph: number
  /** 0 = equirectangular, 1 = Mercator. */
  flatKind: number
  /** Camera position in sphere space (far-side fade). */
  camModel: [number, number, number]
}

interface LayerEntry {
  spec: GlobeLayerSpec
  paramsKey: string
  /** Decoded, waiting for a context to upload into. */
  pending: ImageBitmap | null
  texture: WebGLTexture | null
  box: Vec4
  /** px/degree of the shown texture (0 = none yet). */
  scale: number
  controller: AbortController | null
  errored: boolean
  /** Settled at least once (whenLoaded). */
  settled: boolean
}

interface SeedEntry {
  pending: HTMLCanvasElement | null
  texture: WebGLTexture | null
  box: Vec4
  opacity: number
}

interface LineGroup {
  geometry: Geometry
  color: Vec4
  mesh: Mesh | null
}

type SharedUniform = (typeof SHARED_UNIFORMS)[number]
type LayerProgram = Program<SharedUniform | (typeof LAYER_UNIFORMS)[number]>
type ColorProgram = Program<SharedUniform | (typeof COLOR_UNIFORMS)[number]>

interface GlResources {
  gl: WebGL2RenderingContext
  layerProgram: LayerProgram
  colorProgram: ColorProgram
  surface: Mesh
  maxTextureSize: number
}

/** rgba()/rgb() → vec4. */
function cssColor(css: string): Vec4 {
  const parts = /rgba?\(([^)]+)\)/.exec(css)?.[1].split(',').map(Number) ?? []
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return [r / 255, g / 255, b / 255, a]
}

export const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2

export const easeOutCubic = (p: number) => 1 - (1 - p) ** 3

/** rAF tween of `step(0→1)`; resolves even where rAF is throttled. */
export function tween(
  durationMs: number,
  step: (p: number) => void,
): Promise<void> {
  if (durationMs <= 0) {
    step(1)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    // The clock starts on the first drawn frame, not on the call.
    let start = -1
    let done = false
    const finish = () => {
      if (done) return
      done = true
      step(1)
      resolve()
    }
    const frame = (now: number) => {
      if (done) return
      if (start < 0) start = now
      const p = Math.min(1, (now - start) / durationMs)
      if (p >= 1) return finish()
      step(p)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    window.setTimeout(finish, durationMs + 1500)
  })
}

/** The viewport of a flat camera in unit flat-world coordinates. */
function flatViewportBox(flat: FlatCamera, w: number, h: number): Vec4 | null {
  let world: [number, number]
  let c: [number, number]
  if (flat.projection === 'merc') {
    world = [MERCATOR_WORLD_M, MERCATOR_WORLD_M]
    c = lonLatToMercatorUnit(flat.lon, flat.lat)
  } else if (flat.projection === 'geo') {
    world = [360, 180]
    c = lonLatToEquirectUnit(flat.lon, flat.lat)
  } else {
    return null
  }
  const bw = (w * flat.resolution) / world[0]
  const bh = (h * flat.resolution) / world[1]
  return [c[0] - bw / 2, c[1] - bh / 2, bw, bh]
}

/** Draw a WebGL canvas region (CSS px) into a 2D context, right after rendering. */
export function drawCanvasViewport(
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

/** Flat camera → `flatMatrix` / `flatKind` for a viewport. */
export function applyFlatUniforms(
  uniforms: MorphUniforms,
  flat: FlatCamera,
  width: number,
  height: number,
): void {
  const t = flatClipTransform(flat, width, height)
  if (!t) return
  uniforms.flatKind = flat.projection === 'merc' ? 1 : 0
  // clipX = kx(x − cx), clipY = ky(cy − y); column-major.
  // prettier-ignore
  uniforms.flatMatrix.set([
    t.kx, 0, 0, 0,
    0, -t.ky, 0, 0,
    0, 0, 0, 0,
    -t.kx * t.cx, t.ky * t.cy, 0, 1,
  ])
}

export interface GlobeContent {
  uniforms: MorphUniforms
  setLayers: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  setOutline: (spec: GlobeOutlineSpec | null) => void
  /** The server's own basemap images: z below the data (background) or above (reference). */
  setDecoration: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  /** Bend the flat map's own pixels; null drops them. */
  setSeed: (
    seed: GlobeSeed | null,
    flat: FlatCamera,
    w: number,
    h: number,
  ) => void
  setSeedOpacity: (opacity: number) => void
  whenLoaded: () => Promise<void>
  /** Refetch sharper textures once the camera rests. */
  scheduleUpgrade: () => void
  /** Draw everything with the current uniforms into `gl` (host-owned state). */
  draw: (gl: WebGL2RenderingContext) => void
  /** Draw the seed image (above the host's own layers). */
  drawSeed: (gl: WebGL2RenderingContext) => void
  dispose: () => void
}

export function createGlobeContent({
  events,
  invalidate,
  zoom,
}: {
  events: GlobeEngineEvents
  invalidate: () => void
  /** Current neutral zoom (texture detail). */
  zoom: () => number
}): GlobeContent {
  const uniforms: MorphUniforms = {
    flatMatrix: new Float32Array(16),
    sphereMatrix: new Float32Array(16),
    morph: 1,
    flatKind: 1,
    camModel: [0, 0, 5],
  }
  const layers = new Map<string, LayerEntry>()
  const deco = new Map<string, LayerEntry>()
  const allEntries = () => [...layers.values(), ...deco.values()]
  const loadWaiters: Array<() => void> = []
  let res: GlResources | null = null
  let baseColor = BASE_COLOR.light
  let lineGroups: Array<LineGroup> = []
  let seed: SeedEntry | null = null
  let outline: GlobeOutlineSpec | null = null
  let inFlight = 0
  let upgradeTimer = 0
  let disposed = false

  /** One texel per screen px at the centre, within the size limits. */
  const targetScale = (spec: GlobeLayerSpec) =>
    regionScale(
      layerRegion(spec),
      (2 * Math.PI * globeRadiusPx(zoom())) / 360,
      Math.min(MAX_SIDE, res?.maxTextureSize ?? MAX_SIDE),
    )
  const firstScale = (spec: GlobeLayerSpec) => {
    const [w, , e] = layerRegion(spec)
    return Math.min(targetScale(spec), FIRST_SIDE / (e - w))
  }

  function checkLoaded() {
    if (allEntries().every((e) => e.settled)) {
      for (const resolve of loadWaiters.splice(0)) resolve()
    }
  }

  function setInFlight(delta: number) {
    inFlight += delta
    events.onLoadingChange(inFlight)
  }

  function dropTexture(entry: LayerEntry) {
    if (entry.texture && res) res.gl.deleteTexture(entry.texture)
    entry.texture = null
    entry.pending?.close()
    entry.pending = null
  }

  function load(entry: LayerEntry, scale: number) {
    entry.controller?.abort()
    const controller = new AbortController()
    entry.controller = controller
    const { key, time } = entry.spec
    const region = layerRegion(entry.spec)
    const url = regionGetMapUrl(entry.spec, region, regionSize(region, scale))
    setInFlight(1)
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GetMap ${r.status}`)
        return r.blob()
      })
      .then((blob) =>
        createImageBitmap(blob, {
          premultiplyAlpha: 'premultiply',
          colorSpaceConversion: 'none',
        }),
      )
      .then((bitmap) => {
        if (controller.signal.aborted || disposed) {
          bitmap.close()
          return
        }
        dropTexture(entry)
        entry.pending = bitmap
        const [w, s, e, n] = region
        entry.box = [
          (w + 180) / 360,
          (90 - n) / 180,
          (e - w) / 360,
          (n - s) / 180,
        ]
        entry.scale = scale
        entry.errored = false
        events.onLayerLoad(key, time, true)
        scheduleUpgrade()
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || disposed) return
        log.warn(`Globe GetMap failed for ${entry.spec.layerName}`, err)
        // A stale image must never pose as the requested instant.
        entry.errored = true
        dropTexture(entry)
        events.onLayerLoad(key, time, false)
      })
      .finally(() => {
        if (entry.controller === controller) entry.controller = null
        setInFlight(-1)
        if (!controller.signal.aborted) entry.settled = true
        checkLoaded()
        if (!disposed) invalidate()
      })
  }

  function scheduleUpgrade() {
    window.clearTimeout(upgradeTimer)
    upgradeTimer = window.setTimeout(() => {
      for (const entry of allEntries()) {
        const target = targetScale(entry.spec)
        if (
          !entry.controller &&
          !entry.errored &&
          target > entry.scale * UPGRADE_FACTOR
        )
          load(entry, target)
      }
    }, UPGRADE_IDLE_MS)
  }

  function removeLayer(entry: LayerEntry) {
    entry.controller?.abort()
    dropTexture(entry)
  }

  function clearSeed() {
    if (seed?.texture && res) res.gl.deleteTexture(seed.texture)
    seed = null
  }

  function clearLines() {
    for (const group of lineGroups) {
      if (group.mesh && res) deleteMesh(res.gl, group.mesh)
    }
    lineGroups = []
  }

  function buildOutline() {
    clearLines()
    if (!outline) {
      if (!disposed) invalidate()
      return
    }
    const spec = outline
    const palette = outlinePalette(spec.theme)
    baseColor = BASE_COLOR[spec.theme]
    void loadOutlineData().then(
      (data) => {
        if (disposed || outline !== spec) return
        const groups: Array<[Array<Array<[number, number]>>, string]> = [
          [graticuleLines(), palette.grid],
          [geojsonLines(data.countries), palette.border],
          [geojsonLines(data.coastlines), palette.coast],
        ]
        lineGroups = groups.map(([polylines, color]) => {
          const color4 = cssColor(color)
          color4[3] *= spec.opacity
          return {
            geometry: linesGeometry(polylines),
            color: color4,
            mesh: null,
          }
        })
        invalidate()
      },
      (err: unknown) => log.warn('Outline data failed to load', err),
    )
  }

  /** Programs and the surface mesh live as long as the context. */
  function attach(gl: WebGL2RenderingContext): GlResources {
    if (res?.gl === gl) return res
    if (res) {
      // A new context: the old resources died with the old one.
      for (const entry of allEntries()) entry.texture = null
      for (const group of lineGroups) group.mesh = null
      if (seed) seed.texture = null
    }
    res = {
      gl,
      layerProgram: createProgram(gl, VERTEX, LAYER_FRAGMENT, [
        ...SHARED_UNIFORMS,
        ...LAYER_UNIFORMS,
      ]),
      colorProgram: createProgram(gl, VERTEX, COLOR_FRAGMENT, [
        ...SHARED_UNIFORMS,
        ...COLOR_UNIFORMS,
      ]),
      surface: createMesh(gl, surfaceGeometry()),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    }
    return res
  }

  function setShared(gl: WebGL2RenderingContext, p: Program<SharedUniform>) {
    gl.useProgram(p.program)
    gl.uniformMatrix4fv(p.uniforms.uFlatMatrix, false, uniforms.flatMatrix)
    gl.uniformMatrix4fv(p.uniforms.uSphereMatrix, false, uniforms.sphereMatrix)
    gl.uniform1f(p.uniforms.uMorph, uniforms.morph)
    gl.uniform1f(p.uniforms.uFlatKind, uniforms.flatKind)
    gl.uniform3fv(p.uniforms.uCamModel, uniforms.camModel)
  }

  function setState(gl: WebGL2RenderingContext) {
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    )
  }

  function drawSeed(gl: WebGL2RenderingContext) {
    if (disposed || !seed || seed.opacity <= 0) return
    const r = attach(gl)
    setState(gl)
    const layer = r.layerProgram
    setShared(gl, layer)
    if (seed.pending) {
      seed.texture = createTexture(gl, seed.pending)
      seed.pending = null
    }
    if (!seed.texture) return
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, seed.texture)
    gl.uniform1i(layer.uniforms.uTex, 0)
    gl.uniform1f(layer.uniforms.uFlatUv, 1)
    gl.uniform1f(layer.uniforms.uOpacity, seed.opacity)
    gl.uniform4fv(layer.uniforms.uBox, seed.box)
    drawMesh(gl, r.surface)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.useProgram(null)
  }

  function draw(gl: WebGL2RenderingContext) {
    if (disposed) return
    const r = attach(gl)
    setState(gl)

    // Base fill only shows once round; while flat, OL shows no fill there.
    const color = r.colorProgram
    if (outline) {
      setShared(gl, color)
      gl.uniform4fv(color.uniforms.uColor, baseColor)
      gl.uniform1f(color.uniforms.uOpacity, uniforms.morph)
      drawMesh(gl, r.surface)
    }

    const layer = r.layerProgram
    setShared(gl, layer)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(layer.uniforms.uTex, 0)
    gl.uniform1f(layer.uniforms.uFlatUv, 0)
    const ordered = allEntries().sort((a, b) => a.spec.zIndex - b.spec.zIndex)
    for (const entry of ordered) {
      if (entry.pending) {
        entry.texture = createTexture(gl, entry.pending)
        entry.pending.close()
        entry.pending = null
      }
      if (!entry.texture || entry.spec.opacity <= 0) continue
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.uniform1f(layer.uniforms.uOpacity, entry.spec.opacity)
      gl.uniform4fv(layer.uniforms.uBox, entry.box)
      drawMesh(gl, r.surface)
    }
    gl.bindTexture(gl.TEXTURE_2D, null)

    if (lineGroups.length > 0) {
      setShared(gl, color)
      gl.uniform1f(color.uniforms.uOpacity, 1)
      for (const group of lineGroups) {
        group.mesh ??= createMesh(gl, group.geometry)
        gl.uniform4fv(color.uniforms.uColor, group.color)
        drawMesh(gl, group.mesh)
      }
    }
    gl.useProgram(null)
  }

  /** Match `target` to `specs`: new keys load, changed params reload, the rest update. */
  function reconcile(
    target: Map<string, LayerEntry>,
    specs: ReadonlyArray<GlobeLayerSpec>,
  ) {
    const wanted = new Set<string>()
    for (const spec of specs) {
      wanted.add(spec.key)
      const paramsKey = `${spec.endpoint}|${JSON.stringify(spec.params)}`
      let entry = target.get(spec.key)
      if (!entry) {
        entry = {
          spec,
          paramsKey,
          pending: null,
          texture: null,
          box: [0, 0, 1, 1],
          scale: 0,
          controller: null,
          errored: false,
          settled: false,
        }
        target.set(spec.key, entry)
        load(entry, firstScale(spec))
      } else if (entry.paramsKey !== paramsKey) {
        entry.spec = spec
        entry.paramsKey = paramsKey
        // Keep the shown detail when the time/style changes.
        load(
          entry,
          Math.max(firstScale(spec), Math.min(entry.scale, targetScale(spec))),
        )
      } else {
        entry.spec = spec
      }
    }
    for (const [key, entry] of target) {
      if (wanted.has(key)) continue
      removeLayer(entry)
      target.delete(key)
    }
    checkLoaded()
    invalidate()
  }

  return {
    uniforms,

    setLayers: (specs) => reconcile(layers, specs),

    setDecoration: (specs) => reconcile(deco, specs),

    setOutline: (spec) => {
      outline = spec
      buildOutline()
    },

    setSeed: (next, flat, w, h) => {
      clearSeed()
      const box = flatViewportBox(flat, w, h)
      if (next && box) {
        seed = { pending: next.image, texture: null, box, opacity: 1 }
      }
      if (!disposed) invalidate()
    },

    setSeedOpacity: (opacity) => {
      if (seed) seed.opacity = opacity
    },

    whenLoaded: () =>
      new Promise<void>((resolve) => {
        loadWaiters.push(resolve)
        checkLoaded()
      }),

    scheduleUpgrade,

    draw,

    drawSeed,

    dispose: () => {
      disposed = true
      window.clearTimeout(upgradeTimer)
      for (const entry of allEntries()) removeLayer(entry)
      layers.clear()
      deco.clear()
      outline = null
      clearLines()
      clearSeed()
      if (res) {
        deleteMesh(res.gl, res.surface)
        res.gl.deleteProgram(res.layerProgram.program)
        res.gl.deleteProgram(res.colorProgram.program)
        res = null
      }
      for (const resolve of loadWaiters.splice(0)) resolve()
    },
  }
}
