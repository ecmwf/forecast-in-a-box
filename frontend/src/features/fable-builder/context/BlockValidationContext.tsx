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
 * Per-block validation state — field-level errors and the backend-resolved
 * config map — shared between the builder's block components and field renderers.
 */

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

interface BlockValidation {
  /** Field-level errors keyed by config option key; null when none. */
  fieldErrors: Record<string, Array<string>> | null
  /** Backend-resolved config map (`/blueprint/expand`); null when unresolved. */
  resolvedConfig: Record<string, string> | null
}

const BlockValidationContext = createContext<BlockValidation>({
  fieldErrors: null,
  resolvedConfig: null,
})

export function BlockValidationProvider({
  fieldErrors,
  resolvedConfig,
  children,
}: BlockValidation & { children: ReactNode }) {
  const value = useMemo(
    () => ({ fieldErrors, resolvedConfig }),
    [fieldErrors, resolvedConfig],
  )
  return (
    <BlockValidationContext.Provider value={value}>
      {children}
    </BlockValidationContext.Provider>
  )
}

export function useFieldErrors(): Record<string, Array<string>> | null {
  return useContext(BlockValidationContext).fieldErrors
}

export function useResolvedConfig(): Record<string, string> | null {
  return useContext(BlockValidationContext).resolvedConfig
}
