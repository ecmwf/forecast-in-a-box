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
 * Floating property-inspection card for GeoJSON overlay features —
 * automatic on hover, zero configuration. DOM-only by design: an
 * inspection affordance, not export content (permanent labels are the
 * exportable path).
 */

import type { OverlayHover } from './overlays'

export function OverlayHoverCard({ hover }: { hover: OverlayHover | null }) {
  if (!hover || hover.rows.length === 0) return null
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-64 rounded-md border border-border bg-background/95 px-2 py-1.5 text-xs shadow-md backdrop-blur-sm"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
    >
      <table>
        <tbody>
          {hover.rows.map(([key, value]) => (
            <tr key={key}>
              <td className="pr-2 align-top font-mono text-muted-foreground">
                {key}
              </td>
              <td className="break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hover.more > 0 && (
        <div className="mt-0.5 text-muted-foreground">+{hover.more}</div>
      )}
    </div>
  )
}
