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
out vec2 vFlat;
out float vFacing;
void main() {
  vec2 flatPos = mix(aGeo, aMerc, uFlatKind);
  vec4 flatClip = uFlatMatrix * vec4(flatPos, 0.0, 1.0);
  vec4 sphereClip = uSphereMatrix * vec4(aSphere, 1.0);
  gl_Position = mix(flatClip, sphereClip, uMorph);
  vUv = aGeo;
  vFlat = flatPos;
  vFacing = dot(aSphere, normalize(uCamModel - aSphere));
}
`

// Far side fades in the bend; once round, a 1 px antialiased horizon.
const VISIBILITY = `
uniform float uMorph;
uniform float uFlatKind;
in vec2 vUv;
in float vFacing;
out vec4 fragColor;
// Mercator's latitude limit in unit equirect y.
const float MERC_EDGE = (90.0 - 85.0511) / 180.0;
// Polar rows spike mid-bend: Mercator pins them to the map edge.
bool polarCap() {
  return uFlatKind > 0.5 && uMorph < 0.98 && (vUv.y < MERC_EDGE || vUv.y > 1.0 - MERC_EDGE);
}
float visibility() {
  float edge = max(fwidth(vFacing), 1e-6);
  return mix(1.0, smoothstep(-edge, edge, vFacing), smoothstep(0.0, 0.6, uMorph));
}
`

export const LAYER_UNIFORMS = ['uTex', 'uOpacity', 'uBox', 'uFlatUv'] as const
export const LAYER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
// Texture area, x0, y0, width, height, in unit equirect (or flat) coordinates.
uniform vec4 uBox;
// 1: uBox is in flat-world units (the seed image).
uniform float uFlatUv;
in vec2 vFlat;
${VISIBILITY}
void main() {
  // The seed has no pixels beyond Mercator's edge at any morph.
  if (polarCap() || (uFlatUv > 0.5 && uFlatKind > 0.5 && (vUv.y < MERC_EDGE || vUv.y > 1.0 - MERC_EDGE))) discard;
  vec2 uv = (mix(vUv, vFlat, uFlatUv) - uBox.xy) / uBox.zw;
  // MSAA runs pixel centres just outside the seam triangle: allow one pixel.
  vec2 slack = fwidth(uv);
  if (any(lessThan(uv, -slack)) || any(greaterThan(uv, vec2(1.0) + slack))) discard;
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
  if (polarCap()) discard;
  fragColor = vec4(uColor.rgb * uColor.a, uColor.a) * (uOpacity * visibility());
}
`
