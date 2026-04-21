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
 * Per-block field errors, keyed by configuration option key. Provided by
 * the builder layout components (ConfigPanel, BlockInstanceCard,
 * InlineBlockNode) and consumed by GlyphFieldWrapper to render red borders
 * and inline error messages beneath individual fields.
 *
 * `null` means no field-level errors for this block — either the block is
 * valid, or its errors could not be attributed to a specific field (those
 * are surfaced at the block level instead).
 */

import { createContext, useContext } from 'react'

export const FieldErrorsContext = createContext<Record<
  string,
  Array<string>
> | null>(null)

export function useFieldErrors(): Record<string, Array<string>> | null {
  return useContext(FieldErrorsContext)
}
