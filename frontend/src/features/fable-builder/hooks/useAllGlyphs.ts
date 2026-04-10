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
 * Hook that merges intrinsic and global glyphs into a single typed list.
 */

import { useMemo } from 'react'
import { useAvailableGlyphs, useListGlobalGlyphs } from '@/api/hooks/useFable'

export interface GlyphInfo {
  name: string
  displayName: string
  valueExample: string
  type: 'intrinsic' | 'global'
}

export function useAllGlyphs(): {
  glyphs: Array<GlyphInfo>
  isLoading: boolean
} {
  const { data: intrinsic, isLoading: intrinsicLoading } = useAvailableGlyphs()
  const { data: globalData, isLoading: globalLoading } = useListGlobalGlyphs()

  const glyphs = useMemo(() => {
    const result: Array<GlyphInfo> = []

    if (intrinsic) {
      for (const g of intrinsic) {
        result.push({
          name: g.name,
          displayName: g.display_name,
          valueExample: g.valueExample,
          type: 'intrinsic',
        })
      }
    }

    if (globalData?.glyphs) {
      for (const g of globalData.glyphs) {
        result.push({
          name: g.name,
          displayName: g.display_name,
          valueExample: g.valueExample,
          type: 'global',
        })
      }
    }

    return result
  }, [intrinsic, globalData])

  return { glyphs, isLoading: intrinsicLoading || globalLoading }
}
