/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createContext, useContext, useMemo } from 'react'
import { useResolvedConfig } from './BlockValidationContext'
import type { ReactNode } from 'react'
import { parseValueType } from '@/components/base/fields/value-type-parser'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'

interface BlockConfig {
  /** Config values keyed by option key. */
  values: Record<string, string>
  /** Value types keyed by option key. */
  valueTypes: Record<string, string | undefined>
}

const BlockConfigContext = createContext<BlockConfig | null>(null)

/** The selected block's config, for fields that depend on a sibling. */
export function BlockConfigProvider({
  values,
  valueTypes,
  children,
}: BlockConfig & { children: ReactNode }) {
  const value = useMemo(() => ({ values, valueTypes }), [values, valueTypes])
  return (
    <BlockConfigContext.Provider value={value}>
      {children}
    </BlockConfigContext.Provider>
  )
}

/** The block's geodomain value, glyphs resolved; null without one. */
export function useBlockDomain(): string | null {
  const config = useContext(BlockConfigContext)
  const resolved = useResolvedConfig()
  if (!config) return null
  const key = Object.keys(config.valueTypes).find(
    (k) => parseValueType(config.valueTypes[k]).type === 'geodomain',
  )
  if (key === undefined) return null
  const value = config.values[key] ?? ''
  return containsGlyphs(value) ? (resolved?.[key] ?? null) : value
}
