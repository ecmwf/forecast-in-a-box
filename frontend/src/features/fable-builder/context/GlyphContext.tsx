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
 * Context for providing glyph data to the fable builder component tree.
 * Consumed by StringField for autocomplete and resolved value preview.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { useAllGlyphs } from '@/features/fable-builder/hooks/useAllGlyphs'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const EMPTY_GLYPHS: Record<string, string> = {}

/** Exported for test use — wrap with `<TestGlyphProvider>` to inject test glyphs */
export const GlyphContext = createContext<Array<GlyphInfo>>([])

export function GlyphProvider({ children }: { children: ReactNode }) {
  const localGlyphs =
    useFableBuilderStore((state) => state.fable.local_glyphs) ?? EMPTY_GLYPHS
  const { glyphs } = useAllGlyphs(localGlyphs)
  return (
    <GlyphContext.Provider value={glyphs}>{children}</GlyphContext.Provider>
  )
}

export function useGlyphContext(): Array<GlyphInfo> {
  return useContext(GlyphContext)
}
