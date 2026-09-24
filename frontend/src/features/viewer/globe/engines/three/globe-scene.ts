/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Renderer-free scene builders driven by MapLibre-style clip matrices + morph factor. */

import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  LineSegments,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  Vector3,
  Vector4,
} from 'three'
import {
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
  lonLatToUnitSphere,
} from '../../sphere-math'
import type { Texture } from 'three'

/** Uniforms every globe material shares (one object, many materials). */
export interface MorphUniforms {
  /** Flat unit world → clip. */
  uFlatMatrix: { value: Matrix4 }
  /** Unit sphere → clip. */
  uSphereMatrix: { value: Matrix4 }
  /** 0 = flat, 1 = globe. */
  uMorph: { value: number }
  /** 0 = equirectangular, 1 = Mercator. */
  uFlatKind: { value: number }
  /** Camera position in sphere space (far-side fade). */
  uCamModel: { value: Vector3 }
}

export function createMorphUniforms(): MorphUniforms {
  return {
    uFlatMatrix: { value: new Matrix4() },
    uSphereMatrix: { value: new Matrix4() },
    uMorph: { value: 1 },
    uFlatKind: { value: 1 },
    uCamModel: { value: new Vector3(0, 0, 5) },
  }
}

// Clip-space mix: exact OL frame at 0, exact globe at 1.
const VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aGeo;
in vec2 aMerc;
uniform mat4 uFlatMatrix;
uniform mat4 uSphereMatrix;
uniform float uMorph;
uniform float uFlatKind;
uniform vec3 uCamModel;
out vec2 vUv;
out float vFacing;
void main() {
  vec2 flatPos = mix(aGeo, aMerc, uFlatKind);
  vec4 flatClip = uFlatMatrix * vec4(flatPos, 0.0, 1.0);
  vec4 sphereClip = uSphereMatrix * vec4(position, 1.0);
  gl_Position = mix(flatClip, sphereClip, uMorph);
  vUv = aGeo;
  vFacing = dot(position, normalize(uCamModel - position));
}
`

// Far side fades out as the plane closes into a sphere.
const VISIBILITY = /* glsl */ `
uniform float uMorph;
in vec2 vUv;
in float vFacing;
out vec4 fragColor;
float visibility() {
  return mix(1.0, smoothstep(-0.04, 0.04, vFacing), smoothstep(0.0, 0.6, uMorph));
}
`

const LAYER_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
// Texture area in unit equirect coordinates: x0, y0, width, height.
uniform vec4 uBox;
${VISIBILITY}
void main() {
  vec2 uv = (vUv - uBox.xy) / uBox.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  // Premultiplied texels, passed through untouched (legend colours).
  fragColor = texture(uTex, uv) * (uOpacity * visibility());
}
`

const COLOR_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec4 uColor;
uniform float uOpacity;
${VISIBILITY}
void main() {
  fragColor = vec4(uColor.rgb * uColor.a, uColor.a) * (uOpacity * visibility());
}
`

function morphMaterial(
  shared: MorphUniforms,
  fragmentShader: string,
  own: Record<string, { value: unknown }>,
): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader,
    uniforms: { ...shared, ...own },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  })
}

/** Morph attributes for lon/lat vertices. */
function vertexAttributes(
  lonLats: ReadonlyArray<number>,
): Record<'position' | 'aGeo' | 'aMerc', BufferAttribute> {
  const n = lonLats.length / 2
  const position = new Float32Array(n * 3)
  const geo = new Float32Array(n * 2)
  const merc = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const lon = lonLats[2 * i]
    const lat = lonLats[2 * i + 1]
    position.set(lonLatToUnitSphere(lon, lat), 3 * i)
    geo.set(lonLatToEquirectUnit(lon, lat), 2 * i)
    merc.set(lonLatToMercatorUnit(lon, lat), 2 * i)
  }
  return {
    position: new BufferAttribute(position, 3),
    aGeo: new BufferAttribute(geo, 2),
    aMerc: new BufferAttribute(merc, 2),
  }
}

function geometryOf(lonLats: ReadonlyArray<number>): BufferGeometry {
  const geometry = new BufferGeometry()
  for (const [name, attr] of Object.entries(vertexAttributes(lonLats))) {
    geometry.setAttribute(name, attr)
  }
  return geometry
}

/** Lon/lat grid (1.4° × 1°), shared by the base and every layer. */
export function createSurfaceGeometry(nLon = 256, nLat = 180): BufferGeometry {
  const lonLats: Array<number> = []
  for (let j = 0; j <= nLat; j++) {
    for (let i = 0; i <= nLon; i++) {
      lonLats.push(-180 + (360 * i) / nLon, 90 - (180 * j) / nLat)
    }
  }
  const geometry = geometryOf(lonLats)
  const index: Array<number> = []
  const row = nLon + 1
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      const a = j * row + i
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
    }
  }
  geometry.setIndex(index)
  return geometry
}

function surfaceMesh(
  geometry: BufferGeometry,
  material: RawShaderMaterial,
  renderOrder: number,
): Mesh {
  const mesh = new Mesh(geometry, material)
  // Positions are shader-computed; bounds would cull wrongly.
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return mesh
}

export function createBaseMesh(
  geometry: BufferGeometry,
  shared: MorphUniforms,
  color: Vector4,
): Mesh {
  // Invisible while flat: OL shows no fill there.
  const material = morphMaterial(shared, COLOR_FRAGMENT, {
    uColor: { value: color },
    uOpacity: { value: 1 },
  })
  material.onBeforeRender = () => {
    material.uniforms.uOpacity.value = shared.uMorph.value
  }
  return surfaceMesh(geometry, material, 0)
}

export function createLayerMesh(
  geometry: BufferGeometry,
  shared: MorphUniforms,
  texture: Texture | null,
  renderOrder: number,
): Mesh {
  const material = morphMaterial(shared, LAYER_FRAGMENT, {
    uTex: { value: texture },
    uOpacity: { value: 1 },
    uBox: { value: new Vector4(0, 0, 1, 1) },
  })
  return surfaceMesh(geometry, material, renderOrder)
}

/** Polylines (lon/lat pairs) as segments, densified so they follow the sphere. */
export function createLinesMesh(
  lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  shared: MorphUniforms,
  color: Vector4,
  renderOrder: number,
): LineSegments {
  const lonLats: Array<number> = []
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lon0, lat0] = line[i - 1]
      const [lon1, lat1] = line[i]
      // Antimeridian jumps are not segments.
      if (Math.abs(lon1 - lon0) > 180) continue
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / 2),
      )
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps
        const f1 = (s + 1) / steps
        lonLats.push(
          lon0 + (lon1 - lon0) * f0,
          lat0 + (lat1 - lat0) * f0,
          lon0 + (lon1 - lon0) * f1,
          lat0 + (lat1 - lat0) * f1,
        )
      }
    }
  }
  const material = morphMaterial(shared, COLOR_FRAGMENT, {
    uColor: { value: color },
    uOpacity: { value: 1 },
  })
  const mesh = new LineSegments(geometryOf(lonLats), material)
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return mesh
}

type Position = ReadonlyArray<number>

/** LineString / Polygon (and Multi*) coordinates of a GeoJSON object. */
export function geojsonLines(json: unknown): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  const addLine = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    out.push(
      (coords as Array<Position>)
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => [p[0], p[1]]),
    )
  }
  const visitGeometry = (geometry: unknown) => {
    if (!geometry || typeof geometry !== 'object') return
    const { type, coordinates } = geometry as {
      type?: string
      coordinates?: unknown
    }
    if (!Array.isArray(coordinates)) return
    if (type === 'LineString') addLine(coordinates)
    else if (type === 'MultiLineString' || type === 'Polygon')
      coordinates.forEach(addLine)
    else if (type === 'MultiPolygon')
      coordinates.forEach(
        (poly) => Array.isArray(poly) && poly.forEach(addLine),
      )
  }
  const root = json as {
    type?: string
    features?: Array<{ geometry?: unknown }>
  }
  if (root.type === 'FeatureCollection') {
    for (const feature of root.features ?? []) visitGeometry(feature.geometry)
  } else {
    visitGeometry(root)
  }
  return out
}

/** 30° graticule; meridians stop short of the poles. */
export function graticuleLines(): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = []
  for (let lon = -180; lon < 180; lon += 30) {
    const line: Array<[number, number]> = []
    for (let lat = -80; lat <= 80; lat += 2) line.push([lon, lat])
    lines.push(line)
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const line: Array<[number, number]> = []
    for (let lon = -180; lon <= 180; lon += 2) line.push([lon, lat])
    lines.push(line)
  }
  return lines
}
