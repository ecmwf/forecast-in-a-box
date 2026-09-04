/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Cursor badge: the view's CRS code (+ projected metres on grid
 * projections) and the lat/lon under the pointer.
 */

import { formatLatLon } from '../format'
import type { PointerReadout } from '../hooks/usePointerReadout'

export function PointerReadoutBadge({
  pointer,
  crs,
  metres,
}: {
  pointer: PointerReadout
  /** Projection code of the map, e.g. `EPSG:32661`. */
  crs: string
  /** Show the projected metres (working-grid projections only). */
  metres: boolean
}) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 grid gap-0.5 rounded-md border border-border bg-background/90 px-2.5 py-1 font-mono text-xs tabular-nums shadow-sm backdrop-blur-sm">
      {metres ? (
        <span>
          <span className="text-muted-foreground">{crs}: </span>
          {`(${Math.round(pointer.x)}, ${Math.round(pointer.y)}) m`}
        </span>
      ) : (
        <span className="text-muted-foreground">{crs}</span>
      )}
      <span>{formatLatLon(pointer.lat, pointer.lon)}</span>
    </div>
  )
}
