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
 * Template parameter derivation
 *
 * A template's user-facing parameters are the glyphs it references but does
 * not define. Derived client-side until the backend ships per-parameter
 * metadata (label, type, description).
 */

import { findGlyphSpans } from './glyph-display'
import type { FableBuilderV1 } from '@/api/types/fable.types'

/** Leading identifier of each `${...}` expression, e.g. "${dt | add_days(7)}" → "dt".
 *  Complex expressions may under-detect; builder validation catches the rest. */
export function referencedGlyphNames(value: string): Array<string> {
  const names: Array<string> = []
  for (const span of findGlyphSpans(value)) {
    const expression = value.slice(span.start + 2, span.end - 1)
    const match = expression.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/)
    if (match) names.push(match[1])
  }
  return names
}

/** A block config option that references a parameter */
export interface ParameterUsage {
  blockId: string
  optionId: string
}

export interface TemplateParameters {
  /** Referenced but defined nowhere — the user must provide these */
  required: Array<string>
  /** The template's own glyph defaults, overridable */
  prefilled: Record<string, string>
  /** Block config sites referencing each parameter (for previews/errors) */
  usage: Record<string, Array<ParameterUsage>>
}

/**
 * Derive the parameter surface of a template builder.
 * @param knownGlyphs - names resolvable outside the template (intrinsics, globals)
 */
export function deriveTemplateParameters(
  fable: FableBuilderV1,
  knownGlyphs: ReadonlySet<string>,
): TemplateParameters {
  const referenced = new Set<string>()
  const usage: Record<string, Array<ParameterUsage>> = {}
  for (const [blockId, block] of Object.entries(fable.blocks)) {
    for (const [optionId, value] of Object.entries(
      block.configuration_values,
    )) {
      for (const name of referencedGlyphNames(value)) {
        referenced.add(name)
        ;(usage[name] ??= []).push({ blockId, optionId })
      }
    }
  }
  // Environment variables may reference glyphs too (no preview site)
  for (const value of Object.values(
    fable.environment?.environment_variables ?? {},
  )) {
    for (const name of referencedGlyphNames(value)) referenced.add(name)
  }
  const prefilled = fable.local_glyphs ?? {}
  // Glyph values may reference further glyphs
  for (const value of Object.values(prefilled)) {
    for (const name of referencedGlyphNames(value)) referenced.add(name)
  }
  const required = [...referenced]
    .filter((name) => !(name in prefilled) && !knownGlyphs.has(name))
    .sort()
  return { required, prefilled, usage }
}
