/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** GLSL ES 3.00 for the bending sphere: flat (t = 0) to globe (t = 1) in screen space. */

export const ATTRIBUTES = ['aSphere', 'aGeo', 'aMerc'] as const
/** Texture anisotropy cap; the layer shader bounds its footprints to it too. */
export const MAX_ANISOTROPY = 8
export const SHARED_UNIFORMS = [
  'uFlatMatrix',
  'uSphereMatrix',
  'uT',
  'uFlatKind',
  'uFlatCenterX',
  'uCamModel',
] as const

// Each point moves in a straight line on screen from its flat to its globe position.
export const VERTEX = `#version 300 es
precision highp float;
in vec3 aSphere;
in vec2 aGeo;
in vec2 aMerc;
uniform mat4 uFlatMatrix;
uniform mat4 uSphereMatrix;
uniform float uT;
uniform float uFlatKind;
// The flat camera's centre in unit flat x.
uniform float uFlatCenterX;
uniform vec3 uCamModel;
out vec2 vUv;
out vec2 vFlat;
out float vFacing;
out float vShift;
void main() {
  vec2 flatPos = mix(aGeo, aMerc, uFlatKind);
  // The world copy nearest the flat camera, so nothing crosses the view.
  vShift = floor(uFlatCenterX - flatPos.x + 0.5);
  flatPos.x += vShift;
  vec4 flatClip = uFlatMatrix * vec4(flatPos, 0.0, 1.0);
  vec4 sphereClip = uSphereMatrix * vec4(aSphere, 1.0);
  // The flat matrix is orthographic: its clip xy is already on screen.
  vec2 ndc = mix(flatClip.xy, sphereClip.xy / sphereClip.w, uT);
  // At the sphere's w: exact flat frame at 0, perspective-correct globe at 1.
  gl_Position = vec4(ndc * sphereClip.w, sphereClip.z, sphereClip.w);
  vUv = aGeo;
  vFlat = flatPos;
  vFacing = dot(aSphere, normalize(uCamModel - aSphere));
}
`

// Latitudes the flat map lacks fade in with t; triangles across the copy cut are skipped mid-bend.
const VISIBILITY = `
uniform float uT;
uniform float uFlatKind;
in vec2 vUv;
in float vFacing;
in float vShift;
out vec4 fragColor;
// Mercator's latitude limit in unit equirect y.
const float MERC_EDGE = (90.0 - 85.0511) / 180.0;
bool offFlat() {
  return uFlatKind > 0.5 && (vUv.y < MERC_EDGE || vUv.y > 1.0 - MERC_EDGE);
}
bool acrossCut() {
  return uT < 1.0 && abs(vShift - floor(vShift + 0.5)) > 1e-3;
}
float offFlatFade() {
  return offFlat() ? smoothstep(0.5, 1.0, uT) : 1.0;
}
// Once round, a 1 px antialiased horizon.
float horizon() {
  float edge = max(fwidth(vFacing), 1e-6);
  return smoothstep(-edge, edge, vFacing);
}
// Surfaces: the far side is culled as its triangles turn away; only the horizon is softened.
float surfaceVisibility() {
  return mix(1.0, horizon(), smoothstep(0.9, 1.0, uT)) * offFlatFade();
}
// Lines cannot be culled: their far side fades out late in the bend.
float lineVisibility() {
  return mix(1.0, horizon(), smoothstep(0.3, 0.6, uT)) * offFlatFade();
}
`

export const LAYER_UNIFORMS = [
  'uTex',
  'uOpacity',
  'uBox',
  'uFlatUv',
  'uHole',
] as const
export const LAYER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
// Texture area, x0, y0, width, height, in unit equirect (or flat) coordinates.
uniform vec4 uBox;
// 1: uBox is in flat-world units (the seed image).
uniform float uFlatUv;
// Equirect area a sharper detail texture covers instead (zero = none).
uniform vec4 uHole;
in vec2 vFlat;
${VISIBILITY}
// Equirect x in a box's frame: a box past x = 1 continues across the antimeridian.
float boxX(float x, vec4 box) {
  return x < box.x && box.x + box.z > 1.0 ? x + 1.0 : x;
}
void main() {
  vec2 src = mix(vUv, vFlat, uFlatUv);
  vec2 uv = (src - uBox.xy) / uBox.zw;
  // Gradients before any discard, and before the wrap jump.
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  // The detail's edge slack in equirect units: its hole in the world image must match it.
  vec2 holeSlack = abs(dFdx(vUv)) + abs(dFdy(vUv));
  if (uFlatUv < 0.5) uv.x = (boxX(src.x, uBox) - uBox.x) / uBox.z;
  // MSAA runs pixel centres just outside the seam triangle: allow one pixel.
  vec2 slack = abs(gx) + abs(gy);
  // Longitudes converge at the poles: cap the east-west footprint at the anisotropy limit, so latitudes stay sharp.
  float across = max(max(abs(gx.y), abs(gy.y)), 1e-9);
  float along = max(max(abs(gx.x), abs(gy.x)), 1e-9);
  float k = min(1.0, ${MAX_ANISOTROPY.toFixed(1)} * across / along);
  gx.x *= k;
  gy.x *= k;
  vec2 hole = vec2(boxX(vUv.x, uHole), vUv.y);
  if (uHole.z > 0.0 && all(greaterThanEqual(hole, uHole.xy - holeSlack)) && all(lessThanEqual(hole, uHole.xy + uHole.zw + holeSlack))) discard;
  // The flat map's own pixels exist only where it shows the world.
  if (acrossCut() || (uFlatUv > 0.5 && offFlat())) discard;
  if (any(lessThan(uv, -slack)) || any(greaterThan(uv, vec2(1.0) + slack))) discard;
  // Premultiplied texels, passed through untouched (legend colours).
  fragColor = textureGrad(uTex, uv, gx, gy) * (uOpacity * surfaceVisibility());
}
`

export const COLOR_UNIFORMS = ['uColor', 'uOpacity'] as const
export const COLOR_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform float uOpacity;
${VISIBILITY}
void main() {
  if (acrossCut()) discard;
  fragColor = vec4(uColor.rgb * uColor.a, uColor.a) * (uOpacity * lineVisibility());
}
`
