/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef } from 'react'
import { worldWidthPx } from './globe-camera'
import type { RefObject } from 'react'
import type View from 'ol/View'

/** Outward wheel travel (px) that bends the map into the globe. */
const PRESSURE_PX = 240
/** Pressure resets after this long without outward scrolling. */
const PRESSURE_WINDOW_MS = 500

/** Fires `onTrigger` on continued wheel zoom-out once the flat world no longer fills the panel. */
export function useZoomOutPastWorld(
  containerRef: RefObject<HTMLElement | null>,
  viewRef: RefObject<View>,
  {
    enabled,
    panelCount,
    onTrigger,
  }: {
    enabled: boolean
    /** Side-by-side splits the container between two panels. */
    panelCount: number
    onTrigger: () => void
  },
): void {
  const onTriggerRef = useRef(onTrigger)
  onTriggerRef.current = onTrigger

  useEffect(() => {
    const el = containerRef.current
    if (!enabled || !el) return
    let pressure = 0
    let last = 0
    const onWheel = (e: WheelEvent) => {
      const now = performance.now()
      if (now - last > PRESSURE_WINDOW_MS) pressure = 0
      last = now
      if (e.deltaY <= 0) {
        pressure = 0
        return
      }
      const view = viewRef.current
      const world = worldWidthPx(view)
      const res = view.getResolution()
      if (world === null || res === undefined) return
      const panelWidth = el.clientWidth / panelCount
      // The extent constraint stops zooming out before the zoom floor.
      const floor =
        view.getConstrainedResolution(view.getMaxResolution()) ??
        view.getMaxResolution()
      const atFloor = res >= floor * 0.99
      if (!atFloor && world > 0.75 * panelWidth) {
        pressure = 0
        return
      }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
      pressure += e.deltaY * unit
      if (pressure >= PRESSURE_PX) {
        pressure = 0
        onTriggerRef.current()
      }
    }
    // Capture: OL stops wheel events it consumes.
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [containerRef, viewRef, enabled, panelCount])
}
