/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Draws the layer images, the flat map's pixels and outline lines into a host WebGL2 context. */

import { scaleBandState } from '../wms-capabilities'
import { flatClipTransform, groundMppFromZoom } from './globe-camera'
import {
  MERCATOR_WORLD_M,
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
} from './sphere-math'
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
import type { ShownImage, TextureStore, Vec4 } from './globe-textures'
import type { Mesh, Program } from './webgl/gl'
import type { Geometry } from './webgl/geometry'
import type { FlatCamera, GlobeOutlineSpec, GlobeSeed } from './engine'
import { createLogger } from '@/lib/logger'
import { loadOutlineData, outlinePalette } from '@/lib/map/ol-outline'

const log = createLogger('globe')

const NO_HOLE: Vec4 = [0, 0, 0, 0]

const BASE_COLOR: Record<'light' | 'dark', Vec4> = {
  light: [0.87, 0.9, 0.94, 1],
  dark: [0.12, 0.16, 0.23, 1],
}

/** Uniforms every draw shares; matrices column-major. */
export interface BendUniforms {
  /** Flat unit world -> clip, for the flat end of the bend. */
  flatMatrix: Float32Array
  /** Unit sphere -> clip. */
  sphereMatrix: Float32Array
  /** Bend progress: 0 = the flat map's frame, 1 = the globe. */
  t: number
  /** 0 = equirectangular, 1 = Mercator. */
  flatKind: number
  /** The flat camera's centre in unit flat x. */
  flatCenterX: number
  /** Camera position in sphere space (far-side fade). */
  camModel: [number, number, number]
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

/** rgba()/rgb() -> vec4. */
function cssColor(css: string): Vec4 {
  const parts = /rgba?\(([^)]+)\)/.exec(css)?.[1].split(',').map(Number) ?? []
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return [r / 255, g / 255, b / 255, a]
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

/** Flat camera -> the flat end of the bend for a viewport. */
export function applyFlatUniforms(
  uniforms: BendUniforms,
  flat: FlatCamera,
  width: number,
  height: number,
): void {
  const t = flatClipTransform(flat, width, height)
  if (!t) return
  uniforms.flatKind = flat.projection === 'merc' ? 1 : 0
  uniforms.flatCenterX = t.cx
  // clipX = kx(x - cx), clipY = ky(cy - y); column-major.
  // prettier-ignore
  uniforms.flatMatrix.set([
    t.kx, 0, 0, 0,
    0, -t.ky, 0, 0,
    0, 0, 0, 0,
    -t.kx * t.cx, t.ky * t.cy, 0, 1,
  ])
}

/** A decoded bitmap becomes a texture on first draw. */
function upload(gl: WebGL2RenderingContext, image: ShownImage) {
  if (!image.pending) return
  image.texture = createTexture(gl, image.pending)
  image.pending.close()
  image.pending = null
}

export interface GlobeRenderer {
  uniforms: BendUniforms
  setOutline: (spec: GlobeOutlineSpec | null) => void
  /** The outline's share of its own opacity (a stand-in for Carto fades with it). */
  setOutlineOpacity: (opacity: number) => void
  setSeed: (
    seed: GlobeSeed | null,
    flat: FlatCamera,
    w: number,
    h: number,
  ) => void
  setSeedOpacity: (opacity: number) => void
  draw: (gl: WebGL2RenderingContext) => void
  drawSeed: (gl: WebGL2RenderingContext) => void
  /** The current context's texture size limit (unknown before the first draw). */
  maxTextureSize: () => number | undefined
  deleteTexture: (texture: WebGLTexture) => void
  /** After a context loss: every GL handle is dead. */
  reset: () => void
  dispose: () => void
}

export function createGlobeRenderer({
  store,
  invalidate,
  zoom,
}: {
  store: TextureStore
  invalidate: () => void
  /** Current neutral zoom (scale bands). */
  zoom: () => number
}): GlobeRenderer {
  const uniforms: BendUniforms = {
    flatMatrix: new Float32Array(16),
    sphereMatrix: new Float32Array(16),
    t: 1,
    flatKind: 1,
    flatCenterX: 0.5,
    camModel: [0, 0, 5],
  }
  let res: GlResources | null = null
  let baseColor = BASE_COLOR.light
  let lineGroups: Array<LineGroup> = []
  let seed: SeedEntry | null = null
  let outline: GlobeOutlineSpec | null = null
  let outlineOpacity = 1
  let disposed = false

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
      store.forgetTextures()
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
    gl.uniform1f(p.uniforms.uT, uniforms.t)
    gl.uniform1f(p.uniforms.uFlatKind, uniforms.flatKind)
    gl.uniform1f(p.uniforms.uFlatCenterX, uniforms.flatCenterX)
    gl.uniform3fv(p.uniforms.uCamModel, uniforms.camModel)
  }

  function setState(gl: WebGL2RenderingContext) {
    gl.disable(gl.DEPTH_TEST)
    // The sheet faces the viewer everywhere when flat; the far side turns away as it wraps.
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.frontFace(gl.CCW)
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
      seed.texture = createTexture(gl, seed.pending, { premultiply: true })
      seed.pending = null
    }
    if (!seed.texture) return
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, seed.texture)
    gl.uniform1i(layer.uniforms.uTex, 0)
    gl.uniform1f(layer.uniforms.uFlatUv, 1)
    gl.uniform1f(layer.uniforms.uOpacity, seed.opacity)
    gl.uniform4fv(layer.uniforms.uBox, seed.box)
    gl.uniform4fv(layer.uniforms.uHole, NO_HOLE)
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
    const outlined = outline !== null && outlineOpacity > 0
    if (outlined) {
      setShared(gl, color)
      gl.uniform4fv(color.uniforms.uColor, baseColor)
      gl.uniform1f(color.uniforms.uOpacity, uniforms.t * outlineOpacity)
      drawMesh(gl, r.surface)
    }

    const layer = r.layerProgram
    setShared(gl, layer)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(layer.uniforms.uTex, 0)
    gl.uniform1f(layer.uniforms.uFlatUv, 0)
    const mpp = groundMppFromZoom(zoom())
    store.eachLayer((spec, world, view) => {
      if (world) upload(gl, world)
      if (view) upload(gl, view)
      if ((!world && !view) || spec.opacity <= 0) return
      // Outside the server's scale band the layer is hidden, as on the flat map.
      if (spec.scale && scaleBandState(spec.scale, mpp) !== 'in-range') return
      gl.uniform1f(layer.uniforms.uOpacity, spec.opacity)
      if (world?.texture) {
        gl.bindTexture(gl.TEXTURE_2D, world.texture)
        gl.uniform4fv(layer.uniforms.uBox, world.box)
        gl.uniform4fv(layer.uniforms.uHole, view ? view.box : NO_HOLE)
        drawMesh(gl, r.surface)
      }
      if (view?.texture) {
        gl.bindTexture(gl.TEXTURE_2D, view.texture)
        gl.uniform4fv(layer.uniforms.uBox, view.box)
        gl.uniform4fv(layer.uniforms.uHole, NO_HOLE)
        drawMesh(gl, r.surface)
      }
    })
    gl.bindTexture(gl.TEXTURE_2D, null)

    if (outlined && lineGroups.length > 0) {
      setShared(gl, color)
      gl.uniform1f(color.uniforms.uOpacity, outlineOpacity)
      for (const group of lineGroups) {
        group.mesh ??= createMesh(gl, group.geometry)
        gl.uniform4fv(color.uniforms.uColor, group.color)
        drawMesh(gl, group.mesh)
      }
    }
    gl.useProgram(null)
  }

  return {
    uniforms,

    setOutline: (spec) => {
      outline = spec
      buildOutline()
    },

    setOutlineOpacity: (opacity) => {
      outlineOpacity = opacity
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

    draw,

    drawSeed,

    maxTextureSize: () => res?.maxTextureSize,

    deleteTexture: (texture) => res?.gl.deleteTexture(texture),

    reset: () => {
      res = null
      for (const group of lineGroups) group.mesh = null
      clearSeed()
    },

    dispose: () => {
      disposed = true
      outline = null
      clearLines()
      clearSeed()
      if (res) {
        deleteMesh(res.gl, res.surface)
        res.gl.deleteProgram(res.layerProgram.program)
        res.gl.deleteProgram(res.colorProgram.program)
        res = null
      }
    },
  }
}
