/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Persisted lg+ sidebar widths, exposed as CSS vars the panel classes read
 * (`--geo-left-w` / `--geo-right-w`); unset falls back to the responsive
 * defaults. The skeleton reads the same store so loading matches. */

import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { readStorageJson, writeStorageJson } from '@/lib/storage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export type GeoPanelSide = 'left' | 'right'

export interface GeoPanelWidths {
  left?: number
  right?: number
}

export const GEO_PANEL_MIN_PX = 220
export const GEO_PANEL_MAX_PX = 420

function clampWidth(px: number): number {
  return Math.min(GEO_PANEL_MAX_PX, Math.max(GEO_PANEL_MIN_PX, Math.round(px)))
}

export function readGeoPanelWidths(): GeoPanelWidths {
  return (
    readStorageJson<GeoPanelWidths>(STORAGE_KEYS.layout.geoViewerPanels) ?? {}
  )
}

export function geoPanelStyleVars(widths: GeoPanelWidths): CSSProperties {
  return {
    ...(widths.left !== undefined && { '--geo-left-w': `${widths.left}px` }),
    ...(widths.right !== undefined && { '--geo-right-w': `${widths.right}px` }),
  } as CSSProperties
}

export function useGeoPanelWidths(): {
  widths: GeoPanelWidths
  styleVars: CSSProperties
  setSide: (side: GeoPanelSide, px: number | null) => void
} {
  const [widths, setWidths] = useState<GeoPanelWidths>(readGeoPanelWidths)

  /** `null` clears the override — back to the responsive default. */
  const setSide = useCallback((side: GeoPanelSide, px: number | null) => {
    setWidths((prev) => {
      const next = { ...prev }
      if (px === null) delete next[side]
      else next[side] = clampWidth(px)
      writeStorageJson(STORAGE_KEYS.layout.geoViewerPanels, next)
      return next
    })
  }, [])

  return { widths, styleVars: geoPanelStyleVars(widths), setSide }
}
