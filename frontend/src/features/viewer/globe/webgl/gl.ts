/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Small WebGL2 helpers: programs, meshes, textures, a 4x4 inverse. */

import { ATTRIBUTES } from './shaders'
import type { Geometry } from './geometry'

export interface Program<TUniform extends string> {
  program: WebGLProgram
  uniforms: Record<TUniform, WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${info}`)
  }
  return shader
}

/** Link a program; attribute locations follow `ATTRIBUTES` order. */
export function createProgram<TUniform extends string>(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  uniformNames: ReadonlyArray<TUniform>,
): Program<TUniform> {
  const program = gl.createProgram()
  const vs = compile(gl, gl.VERTEX_SHADER, vertex)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  ATTRIBUTES.forEach((name, i) => gl.bindAttribLocation(program, i, name))
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${info}`)
  }
  const uniforms = {} as Record<TUniform, WebGLUniformLocation | null>
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, name)
  }
  return { program, uniforms }
}

export interface Mesh {
  vao: WebGLVertexArrayObject
  buffers: Array<WebGLBuffer>
  /** gl.TRIANGLES (indexed) or gl.LINES. */
  mode: number
  count: number
}

/** Upload a geometry into a VAO bound to the `ATTRIBUTES` locations. */
export function createMesh(gl: WebGL2RenderingContext, g: Geometry): Mesh {
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const buffers: Array<WebGLBuffer> = []
  const attrib = (location: number, data: Float32Array, size: number) => {
    const buffer = gl.createBuffer()
    buffers.push(buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }
  attrib(0, g.sphere, 3)
  attrib(1, g.geo, 2)
  attrib(2, g.merc, 2)
  let count = g.geo.length / 2
  if (g.index) {
    const buffer = gl.createBuffer()
    buffers.push(buffer)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.index, gl.STATIC_DRAW)
    count = g.index.length
  }
  gl.bindVertexArray(null)
  return { vao, buffers, mode: g.index ? gl.TRIANGLES : gl.LINES, count }
}

export function drawMesh(gl: WebGL2RenderingContext, mesh: Mesh): void {
  gl.bindVertexArray(mesh.vao)
  if (mesh.mode === gl.TRIANGLES) {
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
  } else {
    gl.drawArrays(gl.LINES, 0, mesh.count)
  }
  gl.bindVertexArray(null)
}

export function deleteMesh(gl: WebGL2RenderingContext, mesh: Mesh): void {
  gl.deleteVertexArray(mesh.vao)
  for (const buffer of mesh.buffers) gl.deleteBuffer(buffer)
}

/** Premultiplied RGBA, nearest at every scale: only colours the server drew. */
export function createTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
  { premultiply = false }: { premultiply?: boolean } = {},
): WebGLTexture {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  // Bitmaps arrive premultiplied; canvases need it done on upload.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

/** Column-major 4x4 inverse in double precision; null when singular. */
export function invertMat4(
  m: ArrayLike<number>,
  out: Float64Array = new Float64Array(16),
): Float64Array | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13] = [
    m[0],
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
    m[7],
  ]
  const [a20, a21, a22, a23, a30, a31, a32, a33] = [
    m[8],
    m[9],
    m[10],
    m[11],
    m[12],
    m[13],
    m[14],
    m[15],
  ]
  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32
  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (det === 0) return null
  det = 1 / det
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return out
}
