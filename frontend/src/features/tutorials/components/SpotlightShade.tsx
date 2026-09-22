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
 * Non-blocking spotlight: an overscan box-shadow dims everything but the
 * anchor cut-out; `pointer-events: none` keeps the page fully interactive.
 */

import type { AnchorRect } from '../engine/useTourAnchor'

export function SpotlightShade({
  rect,
  padding = 6,
}: {
  rect: AnchorRect | null
  padding?: number
}) {
  if (rect === null) return null
  return (
    <div
      aria-hidden="true"
      data-slot="spotlight-shade"
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      <div
        className="absolute rounded-lg shadow-[0_0_0_200vmax_rgb(0_0_0/0.35)] ring-2 ring-primary transition-all duration-300"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      />
    </div>
  )
}
