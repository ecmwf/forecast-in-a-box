/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe scene content (layers, textures, outline) for any renderer owner. */

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Scene,
  Texture,
  Vector4,
} from 'three'
import { globeRadiusPx } from '../../globe-camera'
import {
  layerRegion,
  regionGetMapUrl,
  regionScale,
  regionSize,
} from '../../globe-getmap'
import {
  createBaseMesh,
  createLayerMesh,
  createLinesMesh,
  createMorphUniforms,
  createSurfaceGeometry,
  geojsonLines,
  graticuleLines,
} from './globe-scene'
import { flatClipTransform } from './view-math'
import type { LineSegments, Mesh, RawShaderMaterial } from 'three'
import type { MorphUniforms } from './globe-scene'
import type {
  FlatCamera,
  GlobeEngineEvents,
  GlobeLayerSpec,
  GlobeOutlineSpec,
  ViewportDraw,
} from '../../engine'
import { createLogger } from '@/lib/logger'
import { loadOutlineData, outlinePalette } from '@/lib/map/ol-outline'

const log = createLogger('globe')

/** First request per layer at most this wide, then upgraded to on-screen detail. */
const FIRST_SIDE = 1024
const MAX_SIDE = 4096
/** Refetch when the wanted detail beats the shown one by this factor. */
const UPGRADE_FACTOR = 1.25
const UPGRADE_IDLE_MS = 300

const BASE_COLOR = {
  light: new Vector4(0.87, 0.9, 0.94, 1),
  dark: new Vector4(0.12, 0.16, 0.23, 1),
}

interface LayerEntry {
  spec: GlobeLayerSpec
  paramsKey: string
  mesh: Mesh
  texture: Texture | null
  /** px/degree of the shown texture (0 = none yet). */
  scale: number
  controller: AbortController | null
  errored: boolean
  /** Settled at least once (whenLoaded). */
  settled: boolean
}

/** rgba()/rgb() → vec4. */
function cssColor(css: string): Vector4 {
  const parts = /rgba?\(([^)]+)\)/.exec(css)?.[1].split(',').map(Number) ?? []
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return new Vector4(r / 255, g / 255, b / 255, a)
}

export const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2

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
    const start = performance.now()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      step(1)
      resolve()
    }
    const frame = (now: number) => {
      if (done) return
      const p = Math.min(1, (now - start) / durationMs)
      if (p >= 1) return finish()
      step(p)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    window.setTimeout(finish, durationMs + 500)
  })
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

/** Flat camera → `uFlatMatrix` / `uFlatKind` for a viewport. */
export function applyFlatUniforms(
  uniforms: MorphUniforms,
  flat: FlatCamera,
  width: number,
  height: number,
): void {
  const t = flatClipTransform(flat, width, height)
  if (!t) return
  uniforms.uFlatKind.value = flat.projection === 'merc' ? 1 : 0
  // Row-major: clipX = kx(x − cx), clipY = ky(cy − y).
  // prettier-ignore
  uniforms.uFlatMatrix.value.set(
    t.kx, 0, 0, -t.kx * t.cx,
    0, -t.ky, 0, t.ky * t.cy,
    0, 0, 0, 0,
    0, 0, 0, 1,
  )
}

export interface GlobeContent {
  scene: Scene
  uniforms: MorphUniforms
  setLayers: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  setOutline: (spec: GlobeOutlineSpec | null) => void
  whenLoaded: () => Promise<void>
  /** Refetch sharper textures once the camera rests. */
  scheduleUpgrade: () => void
  dispose: () => void
}

export function createGlobeContent({
  events,
  invalidate,
  zoom,
  maxTextureSize,
  anisotropy,
}: {
  events: GlobeEngineEvents
  invalidate: () => void
  /** Current neutral zoom (texture detail). */
  zoom: () => number
  maxTextureSize: () => number
  anisotropy: () => number
}): GlobeContent {
  const scene = new Scene()
  const uniforms = createMorphUniforms()
  const surface = createSurfaceGeometry()
  const layers = new Map<string, LayerEntry>()
  const loadWaiters: Array<() => void> = []
  const base = createBaseMesh(surface, uniforms, BASE_COLOR.light)
  base.visible = false
  scene.add(base)
  let lines: Array<LineSegments> = []
  let outline: GlobeOutlineSpec | null = null
  let inFlight = 0
  let upgradeTimer = 0
  let disposed = false

  /** One texel per screen px at the centre, within the size limits. */
  const targetScale = (spec: GlobeLayerSpec) =>
    regionScale(
      layerRegion(spec),
      (2 * Math.PI * globeRadiusPx(zoom())) / 360,
      Math.min(MAX_SIDE, maxTextureSize()),
    )
  const firstScale = (spec: GlobeLayerSpec) => {
    const [w, , e] = layerRegion(spec)
    return Math.min(targetScale(spec), FIRST_SIDE / (e - w))
  }

  function checkLoaded() {
    if ([...layers.values()].every((e) => e.settled)) {
      for (const resolve of loadWaiters.splice(0)) resolve()
    }
  }

  function setInFlight(delta: number) {
    inFlight += delta
    events.onLoadingChange(inFlight)
  }

  function showTexture(
    entry: LayerEntry,
    bitmap: ImageBitmap,
    region: ReturnType<typeof layerRegion>,
    scale: number,
  ) {
    const texture = new Texture(bitmap)
    texture.flipY = false
    texture.colorSpace = NoColorSpace
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = anisotropy()
    texture.needsUpdate = true
    const old = entry.texture
    const { uniforms: u } = entry.mesh.material as RawShaderMaterial
    u.uTex.value = texture
    const [w, s, e, n] = region
    ;(u.uBox.value as Vector4).set(
      (w + 180) / 360,
      (90 - n) / 180,
      (e - w) / 360,
      (n - s) / 180,
    )
    entry.texture = texture
    entry.scale = scale
    if (old) {
      old.dispose()
      ;(old.image as ImageBitmap | null)?.close()
    }
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
      .then((res) => {
        if (!res.ok) throw new Error(`GetMap ${res.status}`)
        return res.blob()
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
        showTexture(entry, bitmap, region, scale)
        entry.errored = false
        entry.mesh.visible = true
        events.onLayerLoad(key, time, true)
        scheduleUpgrade()
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || disposed) return
        log.warn(`Globe GetMap failed for ${entry.spec.layerName}`, err)
        // A stale image must never pose as the requested instant.
        entry.errored = true
        entry.mesh.visible = false
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
      for (const entry of layers.values()) {
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
    scene.remove(entry.mesh)
    ;(entry.mesh.material as RawShaderMaterial).dispose()
    entry.texture?.dispose()
    ;(entry.texture?.image as ImageBitmap | null)?.close()
  }

  function buildOutline() {
    for (const mesh of lines) {
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as RawShaderMaterial).dispose()
    }
    lines = []
    base.visible = outline !== null
    if (!outline) {
      if (!disposed) invalidate()
      return
    }
    const spec = outline
    const palette = outlinePalette(spec.theme)
    ;(base.material as RawShaderMaterial).uniforms.uColor.value =
      BASE_COLOR[spec.theme]
    void loadOutlineData().then(
      (data) => {
        if (disposed || outline !== spec) return
        const groups: Array<[Array<Array<[number, number]>>, string]> = [
          [graticuleLines(), palette.grid],
          [geojsonLines(data.countries), palette.border],
          [geojsonLines(data.coastlines), palette.coast],
        ]
        lines = groups.map(([polylines, color], i) => {
          const color4 = cssColor(color)
          color4.w *= spec.opacity
          const mesh = createLinesMesh(polylines, uniforms, color4, 1 + i)
          scene.add(mesh)
          return mesh
        })
        invalidate()
      },
      (err: unknown) => log.warn('Outline data failed to load', err),
    )
  }

  return {
    scene,
    uniforms,

    setLayers: (specs) => {
      const wanted = new Set<string>()
      for (const spec of specs) {
        wanted.add(spec.key)
        const paramsKey = `${spec.endpoint}|${JSON.stringify(spec.params)}`
        let entry = layers.get(spec.key)
        if (!entry) {
          const mesh = createLayerMesh(surface, uniforms, null, spec.zIndex)
          mesh.visible = false
          scene.add(mesh)
          entry = {
            spec,
            paramsKey,
            mesh,
            texture: null,
            scale: 0,
            controller: null,
            errored: false,
            settled: false,
          }
          layers.set(spec.key, entry)
          load(entry, firstScale(spec))
        } else if (entry.paramsKey !== paramsKey) {
          entry.spec = spec
          entry.paramsKey = paramsKey
          // Keep the shown detail when the time/style changes.
          load(
            entry,
            Math.max(
              firstScale(spec),
              Math.min(entry.scale, targetScale(spec)),
            ),
          )
        } else {
          entry.spec = spec
        }
        const material = entry.mesh.material as RawShaderMaterial
        material.uniforms.uOpacity.value = spec.opacity
        entry.mesh.renderOrder = spec.zIndex
      }
      for (const [key, entry] of layers) {
        if (wanted.has(key)) continue
        removeLayer(entry)
        layers.delete(key)
      }
      checkLoaded()
      invalidate()
    },

    setOutline: (spec) => {
      outline = spec
      buildOutline()
    },

    whenLoaded: () =>
      new Promise<void>((resolve) => {
        loadWaiters.push(resolve)
        checkLoaded()
      }),

    scheduleUpgrade,

    dispose: () => {
      disposed = true
      window.clearTimeout(upgradeTimer)
      for (const entry of layers.values()) removeLayer(entry)
      layers.clear()
      outline = null
      buildOutline()
      surface.dispose()
      ;(base.material as RawShaderMaterial).dispose()
      for (const resolve of loadWaiters.splice(0)) resolve()
    },
  }
}
