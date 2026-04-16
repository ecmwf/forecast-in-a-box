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
 * Glyph display utilities for parsing and rendering ${...} references.
 */

export interface GlyphSegment {
  text: string
  isGlyph: boolean
}

const GLYPH_PATTERN = /(\$\{\w+\})/g

/**
 * Split a config value into segments of plain text and glyph references.
 *
 * Example: "/data/${runId}/output" → [
 *   { text: "/data/", isGlyph: false },
 *   { text: "${runId}", isGlyph: true },
 *   { text: "/output", isGlyph: false },
 * ]
 */
export function parseGlyphSegments(value: string): Array<GlyphSegment> {
  const segments: Array<GlyphSegment> = []
  let lastIndex = 0

  for (const match of value.matchAll(GLYPH_PATTERN)) {
    const matchIndex = match.index
    if (matchIndex > lastIndex) {
      segments.push({
        text: value.slice(lastIndex, matchIndex),
        isGlyph: false,
      })
    }
    segments.push({ text: match[0], isGlyph: true })
    lastIndex = matchIndex + match[0].length
  }

  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex), isGlyph: false })
  }

  return segments
}

/**
 * Check if a value contains any glyph references.
 */
export function containsGlyphs(value: string): boolean {
  // Use a fresh regex — GLYPH_PATTERN has the `g` flag which makes .test()
  // stateful (advances lastIndex), causing alternating true/false results.
  return /\$\{\w+\}/.test(value)
}

/**
 * Extract the glyph key from a reference like "${runId}" → "runId"
 */
export function extractGlyphKey(ref: string): string {
  return ref.slice(2, -1)
}
