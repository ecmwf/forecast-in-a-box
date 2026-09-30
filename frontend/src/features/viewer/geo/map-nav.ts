/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Pan and zoom steps shared by the flat maps and the globe, and their flat-view moves. */

import { rotate } from 'ol/coordinate'
import { easeOut } from 'ol/easing'
import type View from 'ol/View'

/** Screen px per pan press. */
export const NAV_PAN_PX = 80
/** Zoom levels per press: half a level, a sqrt(2) scale step. */
export const NAV_ZOOM_STEP = 0.5
const NAV_EASE_MS = 300

/** Ease per press; none under reduced motion. */
export function navEaseMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : NAV_EASE_MS
}
/** Right inset keeping slot tags and their badges clear of MapNavControls. */
export const NAV_CLEARANCE = 'right-30'

/** Pan by screen px (+dy = down), kept inside the view's extent; instant unless eased. */
export function panView(view: View, dx: number, dy: number, durationMs = 0) {
  const center = view.getCenter()
  const resolution = view.getResolution()
  if (!center || resolution === undefined) return
  const delta = rotate([dx * resolution, -dy * resolution], view.getRotation())
  const target = [center[0] + delta[0], center[1] + delta[1]]
  const next = view.getConstrainedCenter(target, resolution) ?? target
  if (durationMs <= 0) return view.setCenter(next)
  view.cancelAnimations()
  view.animate({ center: next, duration: durationMs, easing: easeOut })
}

/** Zoom by `delta` levels about the centre, within the view's zoom limits. */
export function zoomView(view: View, delta: number, durationMs = navEaseMs()) {
  const zoom = view.getZoom()
  if (zoom === undefined) return
  view.cancelAnimations()
  view.animate({
    zoom: view.getConstrainedZoom(zoom + delta),
    duration: durationMs,
    easing: easeOut,
  })
}
