/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** GLSL ES 3.00 for the morphing sphere, driven by MapLibre-style clip matrices. */

export const ATTRIBUTES = ['aSphere', 'aGeo', 'aMerc'] as const
export const SHARED_UNIFORMS = [
  'uFlatMatrix',
  'uSphereMatrix',
  'uMorph',
  'uFlatKind',
  'uCamModel',
] as const

// Clip-space mix: exact OL frame at 0, exact globe at 1.
export const VERTEX = `#version 300 es
precision highp float;
in vec3 aSphere;
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
  vec4 sphereClip = uSphereMatrix * vec4(aSphere, 1.0);
  gl_Position = mix(flatClip, sphereClip, uMorph);
  vUv = aGeo;
  vFacing = dot(aSphere, normalize(uCamModel - aSphere));
}
`

// Far side fades in the bend; once round, a 1 px antialiased horizon.
const VISIBILITY = `
uniform float uMorph;
in vec2 vUv;
in float vFacing;
out vec4 fragColor;
float visibility() {
  float edge = max(fwidth(vFacing), 1e-6);
  return mix(1.0, smoothstep(-edge, edge, vFacing), smoothstep(0.0, 0.6, uMorph));
}
`

export const LAYER_UNIFORMS = ['uTex', 'uOpacity', 'uBox'] as const
export const LAYER_FRAGMENT = `#version 300 es
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

export const COLOR_UNIFORMS = ['uColor', 'uOpacity'] as const
export const COLOR_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform float uOpacity;
${VISIBILITY}
void main() {
  fragColor = vec4(uColor.rgb * uColor.a, uColor.a) * (uOpacity * visibility());
}
`
