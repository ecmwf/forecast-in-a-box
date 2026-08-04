/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Client-side mirror of the backend's validate_glyph() (#622): a glyph name
 * must not shadow an intrinsic glyph or a jinja filter/global. Name sets come
 * live from the API; while they load, checks pass and the server enforces. */

import { useMemo } from 'react'
import { useAvailableGlyphs, useGlyphFunctions } from '@/api/hooks/useFable'

export type ReservedGlyphReason = 'intrinsic' | 'jinja'

/** Intrinsic wins over jinja, matching the backend's check order. */
export function reservedGlyphReason(
  name: string,
  intrinsicNames: ReadonlySet<string>,
  jinjaNames: ReadonlySet<string>,
): ReservedGlyphReason | null {
  if (intrinsicNames.has(name)) return 'intrinsic'
  if (jinjaNames.has(name)) return 'jinja'
  return null
}

export function useReservedGlyphReason(): (
  name: string,
) => ReservedGlyphReason | null {
  const { data: intrinsics } = useAvailableGlyphs()
  const { data: functions } = useGlyphFunctions()
  return useMemo(() => {
    const intrinsicNames = new Set((intrinsics ?? []).map((g) => g.name))
    const jinjaNames = new Set((functions?.functions ?? []).map((f) => f.name))
    return (name: string) =>
      reservedGlyphReason(name, intrinsicNames, jinjaNames)
  }, [intrinsics, functions])
}
