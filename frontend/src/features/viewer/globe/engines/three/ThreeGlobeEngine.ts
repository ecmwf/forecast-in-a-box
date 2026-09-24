/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** three.js engine: own renderer, perspective camera and gestures. */

import { Camera, Matrix4, PerspectiveCamera, WebGLRenderer } from 'three'
import { globeMinZoom, panGlobeCamera } from '../../globe-camera'
import { lonLatToUnitSphere } from '../../sphere-math'
import { GLOBE_ENGINES } from '../registry'
import {
  applyFlatUniforms,
  createGlobeContent,
  drawCanvasViewport,
  easeInOutCubic,
  tween,
} from './globe-content'
import { FOV_DEG, cameraDistance, pickLonLat } from './view-math'
import type { GlobeContent } from './globe-content'
import type { FlatCamera, GlobeCamera, GlobeEngine } from '../../engine'
import { createLogger } from '@/lib/logger'
import { loadOutlineData } from '@/lib/map/ol-outline'

const log = createLogger('globe')

const { maxZoom: MAX_ZOOM } = GLOBE_ENGINES.three.capabilities
const INERTIA_TAU_MS = 300
/** The wheel gesture that bent the map in is not globe input. */
const WHEEL_SETTLE_MS = 400
const D2R = Math.PI / 180

export function createThreeGlobeEngine(): GlobeEngine {
  // Materials compute gl_Position; render() only needs a camera object.
  const renderCamera = new Camera()
  const perspective = new PerspectiveCamera(FOV_DEG, 1, 0.01, 10)

  let content: GlobeContent | null = null
  let renderer: WebGLRenderer | null = null
  let container: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let onUserCamera: ((camera: GlobeCamera) => void) | null = null
  let camera: GlobeCamera = { lon: 0, lat: 20, zoom: 1 }
  let flat: FlatCamera | null = null
  let width = 1
  let height = 1
  let frame = 0
  let animating = false
  let wheelLockUntil = 0
  let destroyed = false
  const detach: Array<() => void> = []

  function updateUniforms(u: GlobeContent['uniforms']) {
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
    u.uSphereMatrix.value
      .multiplyMatrices(
        perspective.projectionMatrix,
        perspective.matrixWorldInverse,
      )
      .multiply(model)
    const [cx, cy, cz] = lonLatToUnitSphere(camera.lon, camera.lat)
    u.uCamModel.value.set(cx * d, cy * d, cz * d)
    if (flat) applyFlatUniforms(u, flat, width, height)
  }

  function render() {
    frame = 0
    if (!renderer || !content || destroyed) return
    updateUniforms(content.uniforms)
    renderer.render(content.scene, renderCamera)
  }

  function invalidate() {
    if (frame || animating || destroyed) return
    frame = requestAnimationFrame(render)
  }

  function animate(durationMs: number, step: (p: number) => void) {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    animating = true
    return tween(durationMs, (p) => {
      step(p)
      render()
    }).finally(() => {
      animating = false
    })
  }

  function emitUser() {
    onUserCamera?.(camera)
    content?.scheduleUpgrade()
    invalidate()
  }

  function setZoom(zoom: number) {
    camera = {
      ...camera,
      zoom: Math.max(globeMinZoom(width, height), Math.min(MAX_ZOOM, zoom)),
    }
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
        camera = panGlobeCamera(camera, dx, dy)
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
        camera = panGlobeCamera(
          camera,
          velocity.x * (now - last),
          velocity.y * (now - last),
        )
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
    mount: async (el, events) => {
      container = el
      onUserCamera = (cam) => events.onCameraChange(cam, 'user')
      const gl = new WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
      })
      renderer = gl
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      gl.setClearColor(0x000000, 0)
      content = createGlobeContent({
        events,
        invalidate,
        zoom: () => camera.zoom,
        maxTextureSize: () => gl.capabilities.maxTextureSize,
        anisotropy: () => gl.capabilities.getMaxAnisotropy(),
      })
      const canvas = gl.domElement
      canvas.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;touch-action:none'
      canvas.dataset.testid = 'globe-canvas'
      el.appendChild(canvas)
      const onLost = (e: Event) => {
        e.preventDefault()
        events.onContextLost()
      }
      canvas.addEventListener('webglcontextlost', onLost)
      detach.push(() => canvas.removeEventListener('webglcontextlost', onLost))
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

    setLayers: (specs) => content?.setLayers(specs),

    setBasemap: (spec) => content?.setOutline(spec),

    getCamera: () => camera,

    setCamera: (next) => {
      camera = next
      content?.scheduleUpgrade()
      invalidate()
    },

    whenLoaded: () => content?.whenLoaded() ?? Promise.resolve(),

    morphIn: (from, to, durationMs) => {
      if (!content) return Promise.resolve()
      const u = content.uniforms
      flat = from
      camera = to
      u.uMorph.value = 0
      return animate(durationMs, (p) => {
        u.uMorph.value = easeInOutCubic(p)
      }).then(() => {
        wheelLockUntil = performance.now() + WHEEL_SETTLE_MS
        content?.scheduleUpgrade()
      })
    },

    morphOut: (to, durationMs) => {
      if (!content) return Promise.resolve()
      const u = content.uniforms
      flat = to
      return animate(durationMs, (p) => {
        u.uMorph.value = 1 - easeInOutCubic(p)
      })
    },

    pick: (px) =>
      content?.uniforms.uMorph.value === 1
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

    drawViewport: (ctx, opts) => {
      render()
      if (renderer) drawCanvasViewport(renderer.domElement, width, ctx, opts)
    },

    size: () => [width, height],

    destroy: () => {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      for (const fn of detach.splice(0)) fn()
      resizeObserver?.disconnect()
      content?.dispose()
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      renderer = null
    },
  }
}
