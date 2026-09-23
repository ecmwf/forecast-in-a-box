/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** three.js engine: one world EPSG:4326 texture per layer on a unit sphere. */

import {
  Camera,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  NoColorSpace,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector4,
  WebGLRenderer,
} from 'three'
import { globeMinZoom, globeRadiusPx, panGlobeCamera } from '../../globe-camera'
import { lonLatToUnitSphere } from '../../sphere-math'
import { worldGetMapUrl } from '../../world-getmap'
import { GLOBE_ENGINES } from '../registry'
import {
  createBaseMesh,
  createLayerMesh,
  createLinesMesh,
  createMorphUniforms,
  createSurfaceGeometry,
  geojsonLines,
  graticuleLines,
} from './globe-scene'
import {
  FOV_DEG,
  cameraDistance,
  flatClipTransform,
  pickLonLat,
  textureWidthFor,
} from './view-math'
import type { LineSegments, Mesh, RawShaderMaterial } from 'three'
import type {
  FlatCamera,
  GlobeCamera,
  GlobeEngine,
  GlobeEngineEvents,
  GlobeLayerSpec,
  GlobeOutlineSpec,
} from '../../engine'
import { createLogger } from '@/lib/logger'
import { loadOutlineData, outlinePalette } from '@/lib/map/ol-outline'

const log = createLogger('globe')

const { maxZoom: MAX_ZOOM } = GLOBE_ENGINES.three.capabilities
/** First request per layer: fast, then upgraded to the on-screen detail. */
const FIRST_WIDTH = 1024
const MAX_WIDTH = 4096
const UPGRADE_IDLE_MS = 300
const INERTIA_TAU_MS = 300
/** The wheel gesture that bent the map in is not globe input. */
const WHEEL_SETTLE_MS = 400
const D2R = Math.PI / 180

const BASE_COLOR = {
  light: new Vector4(0.87, 0.9, 0.94, 1),
  dark: new Vector4(0.12, 0.16, 0.23, 1),
}

interface LayerEntry {
  spec: GlobeLayerSpec
  paramsKey: string
  mesh: Mesh
  texture: Texture | null
  /** Width of the shown texture (0 = none yet). */
  width: number
  controller: AbortController | null
  errored: boolean
  /** Settled at least once (whenLoaded). */
  settled: boolean
}

/** rgba()/rgb() → premultiplication-ready vec4. */
function cssColor(css: string): Vector4 {
  const parts = /rgba?\(([^)]+)\)/.exec(css)?.[1].split(',').map(Number) ?? []
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return new Vector4(r / 255, g / 255, b / 255, a)
}

const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2

export function createThreeGlobeEngine(): GlobeEngine {
  const scene = new Scene()
  // Materials compute gl_Position; render() only needs a camera object.
  const renderCamera = new Camera()
  const perspective = new PerspectiveCamera(FOV_DEG, 1, 0.01, 10)
  const shared = createMorphUniforms()
  const surface = createSurfaceGeometry()
  const layers = new Map<string, LayerEntry>()
  const loadWaiters: Array<() => void> = []

  let renderer: WebGLRenderer | null = null
  let container: HTMLElement | null = null
  let events: GlobeEngineEvents | null = null
  let resizeObserver: ResizeObserver | null = null
  let base: Mesh | null = null
  let lines: Array<LineSegments> = []
  let outline: GlobeOutlineSpec | null = null
  let camera: GlobeCamera = { lon: 0, lat: 20, zoom: 1 }
  let flat: FlatCamera | null = null
  let width = 1
  let height = 1
  let frame = 0
  let animating = false
  let wheelLockUntil = 0
  let inFlight = 0
  let upgradeTimer = 0
  let destroyed = false
  const detach: Array<() => void> = []

  function updateUniforms() {
    const d = cameraDistance(camera.zoom, height)
    perspective.aspect = width / height
    perspective.near = Math.max((d - 1) * 0.5, 1e-5)
    perspective.far = d + 2
    perspective.position.set(0, 0, d)
    perspective.updateProjectionMatrix()
    perspective.updateMatrixWorld()
    const model = new Matrix4()
      .makeRotationX(camera.lat * D2R)
      .multiply(new Matrix4().makeRotationY(-camera.lon * D2R))
    shared.uSphereMatrix.value
      .multiplyMatrices(
        perspective.projectionMatrix,
        perspective.matrixWorldInverse,
      )
      .multiply(model)
    const [cx, cy, cz] = lonLatToUnitSphere(camera.lon, camera.lat)
    shared.uCamModel.value.set(cx * d, cy * d, cz * d)

    const t = flat ? flatClipTransform(flat, width, height) : null
    if (t) {
      shared.uFlatKind.value = flat?.projection === 'merc' ? 1 : 0
      // Row-major: clipX = kx(x − cx), clipY = ky(cy − y).
      shared.uFlatMatrix.value.set(
        t.kx,
        0,
        0,
        -t.kx * t.cx,
        0,
        -t.ky,
        0,
        t.ky * t.cy,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
      )
    }
  }

  function render() {
    frame = 0
    if (!renderer || destroyed) return
    updateUniforms()
    renderer.render(scene, renderCamera)
  }

  function invalidate() {
    if (frame || animating || destroyed) return
    frame = requestAnimationFrame(render)
  }

  /** Tween `apply(0→1)`; resolves even where rAF is throttled. */
  function tween(
    durationMs: number,
    apply: (p: number) => void,
  ): Promise<void> {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (durationMs <= 0) {
      apply(1)
      render()
      return Promise.resolve()
    }
    animating = true
    return new Promise((resolve) => {
      const start = performance.now()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        animating = false
        apply(1)
        render()
        resolve()
      }
      const step = (now: number) => {
        if (done) return
        const p = Math.min(1, (now - start) / durationMs)
        if (p >= 1) return finish()
        apply(p)
        render()
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      window.setTimeout(finish, durationMs + 500)
    })
  }

  function targetWidth(): number {
    const max = Math.min(
      MAX_WIDTH,
      renderer?.capabilities.maxTextureSize ?? MAX_WIDTH,
    )
    return textureWidthFor(globeRadiusPx(camera.zoom), max)
  }

  function checkLoaded() {
    if ([...layers.values()].every((e) => e.settled)) {
      for (const resolve of loadWaiters.splice(0)) resolve()
    }
  }

  function setInFlight(delta: number) {
    inFlight += delta
    events?.onLoadingChange(inFlight)
  }

  function showTexture(entry: LayerEntry, bitmap: ImageBitmap, w: number) {
    const texture = new Texture(bitmap)
    texture.flipY = false
    texture.colorSpace = NoColorSpace
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1
    texture.needsUpdate = true
    const old = entry.texture
    ;(entry.mesh.material as RawShaderMaterial).uniforms.uTex.value = texture
    entry.texture = texture
    entry.width = w
    if (old) {
      old.dispose()
      ;(old.image as ImageBitmap | null)?.close()
    }
  }

  function load(entry: LayerEntry, w: number) {
    entry.controller?.abort()
    const controller = new AbortController()
    entry.controller = controller
    const { key, time } = entry.spec
    setInFlight(1)
    fetch(worldGetMapUrl(entry.spec, w), { signal: controller.signal })
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
        if (controller.signal.aborted || destroyed) {
          bitmap.close()
          return
        }
        showTexture(entry, bitmap, w)
        entry.errored = false
        entry.mesh.visible = true
        events?.onLayerLoad(key, time, true)
        scheduleUpgrade()
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || destroyed) return
        log.warn(`Globe GetMap failed for ${entry.spec.layerName}`, err)
        // A stale image must never pose as the requested instant.
        entry.errored = true
        entry.mesh.visible = false
        events?.onLayerLoad(key, time, false)
      })
      .finally(() => {
        if (entry.controller === controller) entry.controller = null
        setInFlight(-1)
        if (!controller.signal.aborted) entry.settled = true
        checkLoaded()
        invalidate()
      })
  }

  /** Sharper textures once the camera rests. */
  function scheduleUpgrade() {
    window.clearTimeout(upgradeTimer)
    upgradeTimer = window.setTimeout(() => {
      const w = targetWidth()
      for (const entry of layers.values()) {
        if (!entry.controller && !entry.errored && entry.width < w)
          load(entry, w)
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
    if (base) base.visible = outline !== null
    if (!outline) return invalidate()
    const spec = outline
    const palette = outlinePalette(spec.theme)
    if (base) {
      ;(base.material as RawShaderMaterial).uniforms.uColor.value =
        BASE_COLOR[spec.theme]
    }
    void loadOutlineData().then(
      (data) => {
        if (destroyed || outline !== spec) return
        const groups: Array<[Array<Array<[number, number]>>, string]> = [
          [graticuleLines(), palette.grid],
          [geojsonLines(data.countries), palette.border],
          [geojsonLines(data.coastlines), palette.coast],
        ]
        lines = groups.map(([polylines, color], i) => {
          const color4 = cssColor(color)
          color4.w *= spec.opacity
          const mesh = createLinesMesh(polylines, shared, color4, 1 + i)
          scene.add(mesh)
          return mesh
        })
        invalidate()
      },
      (err: unknown) => log.warn('Outline data failed to load', err),
    )
  }

  function emitUser() {
    events?.onCameraChange(camera, 'user')
    scheduleUpgrade()
    invalidate()
  }

  function setZoom(zoom: number) {
    camera = {
      ...camera,
      zoom: Math.max(globeMinZoom(width, height), Math.min(MAX_ZOOM, zoom)),
    }
  }

  function rotateBy(dxPx: number, dyPx: number) {
    camera = panGlobeCamera(camera, dxPx, dyPx)
  }

  function attachInteraction(el: HTMLElement) {
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; zoom: number } | null = null
    let velocity = { x: 0, y: 0, t: 0 }
    let inertiaFrame = 0

    const pinchDist = () => {
      const [p, q] = [...pointers.values()]
      return Math.hypot(p.x - q.x, p.y - q.y)
    }
    const onDown = (e: PointerEvent) => {
      if (animating) return
      cancelAnimationFrame(inertiaFrame)
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      velocity = { x: 0, y: 0, t: performance.now() }
      pinch =
        pointers.size === 2 ? { dist: pinchDist(), zoom: camera.zoom } : null
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev || animating) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch && pointers.size === 2) {
        setZoom(pinch.zoom + Math.log2(pinchDist() / pinch.dist))
      } else if (pointers.size === 1) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        const now = performance.now()
        const dt = Math.max(1, now - velocity.t)
        velocity = { x: dx / dt, y: dy / dt, t: now }
        rotateBy(dx, dy)
      }
      emitUser()
    }
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      if (pointers.size < 2) pinch = null
      if (pointers.size > 0 || performance.now() - velocity.t > 80) return
      let last = performance.now()
      const glide = (now: number) => {
        const decay = Math.exp(-(now - last) / INERTIA_TAU_MS)
        velocity.x *= decay
        velocity.y *= decay
        rotateBy(velocity.x * (now - last), velocity.y * (now - last))
        last = now
        emitUser()
        if (Math.hypot(velocity.x, velocity.y) > 0.01) {
          inertiaFrame = requestAnimationFrame(glide)
        }
      }
      inertiaFrame = requestAnimationFrame(glide)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (animating) return
      const now = performance.now()
      if (now < wheelLockUntil) {
        // Swallow the gesture's momentum until the wheel pauses.
        wheelLockUntil = now + 150
        return
      }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
      setZoom(camera.zoom - e.deltaY * unit * 0.002)
      emitUser()
    }
    const onDblClick = () => {
      if (animating) return
      setZoom(camera.zoom + 1)
      emitUser()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDblClick)
    detach.push(() => {
      cancelAnimationFrame(inertiaFrame)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDblClick)
    })
  }

  function measure() {
    if (!container || !renderer) return
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height, false)
  }

  return {
    mount: async (el, handlers) => {
      container = el
      events = handlers
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      const canvas = renderer.domElement
      canvas.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;touch-action:none'
      canvas.dataset.testid = 'globe-canvas'
      el.appendChild(canvas)
      const onLost = (e: Event) => {
        e.preventDefault()
        events?.onContextLost()
      }
      canvas.addEventListener('webglcontextlost', onLost)
      detach.push(() => canvas.removeEventListener('webglcontextlost', onLost))
      base = createBaseMesh(surface, shared, BASE_COLOR.light)
      base.visible = false
      scene.add(base)
      measure()
      resizeObserver = new ResizeObserver(() => {
        measure()
        invalidate()
      })
      resizeObserver.observe(el)
      attachInteraction(canvas)
      await loadOutlineData().catch((err: unknown) =>
        log.warn('Outline data failed to load', err),
      )
    },

    setLayers: (specs) => {
      const wanted = new Set<string>()
      for (const spec of specs) {
        wanted.add(spec.key)
        const paramsKey = `${spec.endpoint}|${JSON.stringify(spec.params)}`
        let entry = layers.get(spec.key)
        if (!entry) {
          const mesh = createLayerMesh(surface, shared, null, spec.zIndex)
          mesh.visible = false
          scene.add(mesh)
          entry = {
            spec,
            paramsKey,
            mesh,
            texture: null,
            width: 0,
            controller: null,
            errored: false,
            settled: false,
          }
          layers.set(spec.key, entry)
          load(entry, FIRST_WIDTH)
        } else if (entry.paramsKey !== paramsKey) {
          entry.spec = spec
          entry.paramsKey = paramsKey
          load(
            entry,
            Math.max(FIRST_WIDTH, Math.min(entry.width, targetWidth())),
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

    getCamera: () => camera,

    setCamera: (next) => {
      camera = next
      scheduleUpgrade()
      invalidate()
    },

    whenLoaded: () =>
      new Promise<void>((resolve) => {
        loadWaiters.push(resolve)
        checkLoaded()
      }),

    morphIn: (from, to, durationMs) => {
      flat = from
      camera = to
      shared.uMorph.value = 0
      return tween(durationMs, (p) => {
        shared.uMorph.value = easeInOutCubic(p)
      }).then(() => {
        wheelLockUntil = performance.now() + WHEEL_SETTLE_MS
        scheduleUpgrade()
      })
    },

    morphOut: (to, durationMs) => {
      flat = to
      return tween(durationMs, (p) => {
        shared.uMorph.value = 1 - easeInOutCubic(p)
      })
    },

    pick: (px) =>
      shared.uMorph.value === 1
        ? pickLonLat(px, [width, height], camera)
        : null,

    capture: () => {
      render()
      const src = renderer!.domElement
      const out = document.createElement('canvas')
      out.width = src.width
      out.height = src.height
      out.getContext('2d')?.drawImage(src, 0, 0)
      return out
    },

    size: () => [width, height],

    destroy: () => {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(upgradeTimer)
      for (const fn of detach.splice(0)) fn()
      resizeObserver?.disconnect()
      for (const entry of layers.values()) removeLayer(entry)
      layers.clear()
      outline = null
      buildOutline()
      surface.dispose()
      ;(base?.material as RawShaderMaterial | undefined)?.dispose()
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      renderer = null
      for (const resolve of loadWaiters.splice(0)) resolve()
    },
  }
}
