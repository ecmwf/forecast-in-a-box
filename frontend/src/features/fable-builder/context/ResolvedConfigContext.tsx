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
 * Exposes the backend-resolved configuration map for the currently-rendered
 * block. Populated from `/blueprint/expand` via useFableValidation and
 * consumed by GlyphFieldWrapper / GlyphTextInput to render authoritative
 * "resolves to" previews. Backend is the sole source of truth — when a
 * value is missing from this map, no preview is rendered.
 */

import { createContext, useContext } from 'react'

export const ResolvedConfigContext = createContext<Record<
  string,
  string
> | null>(null)

export function useResolvedConfig(): Record<string, string> | null {
  return useContext(ResolvedConfigContext)
}
