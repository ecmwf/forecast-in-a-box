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
 * Glyph display utilities for parsing and rendering ${...} expressions.
 *
 * The substitution body can contain pipe-style filters, function calls and
 * string literals (e.g. `${func("a}b") | filter(2)}`), so a regex isn't
 * enough — we run a small scanner that tracks string-literal state and
 * matches `}` only outside of quoted segments.
 */

export interface GlyphSegment {
  text: string
  isGlyph: boolean
}

export interface GlyphSpan {
  /** Index of `$` in the original string. */
  start: number
  /** Exclusive end — one past the closing `}`. */
  end: number
}

/**
 * Walk `text` collecting every closed `${...}` span, honouring string
 * literals inside the body (single/double quotes with backslash escapes).
 *
 * Stops at the first unterminated `${` and sets `terminated: false`. Closed
 * spans already found before that point are still returned.
 */
function scanGlyphSpans(text: string): {
  spans: Array<GlyphSpan>
  terminated: boolean
} {
  const spans: Array<GlyphSpan> = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '$' || text[i + 1] !== '{') {
      i++
      continue
    }
    const start = i
    let j = i + 2
    let inString: '"' | "'" | null = null
    let closed = false
    while (j < text.length) {
      const c = text[j]
      if (inString) {
        if (c === '\\' && j + 1 < text.length) {
          j += 2
          continue
        }
        if (c === inString) inString = null
        j++
        continue
      }
      if (c === '"' || c === "'") {
        inString = c
        j++
        continue
      }
      if (c === '}') {
        closed = true
        break
      }
      j++
    }
    if (!closed) return { spans, terminated: false }
    spans.push({ start, end: j + 1 })
    i = j + 1
  }
  return { spans, terminated: true }
}

/**
 * All closed `${...}` spans in `text`. Unterminated substitutions are
 * skipped; see {@link hasUnterminatedGlyph} to detect them explicitly.
 */
export function findGlyphSpans(text: string): Array<GlyphSpan> {
  return scanGlyphSpans(text).spans
}

/** True if `text` contains a `${` with no matching `}` (string literals honoured). */
export function hasUnterminatedGlyph(text: string): boolean {
  return !scanGlyphSpans(text).terminated
}

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
  for (const span of findGlyphSpans(value)) {
    if (span.start > lastIndex) {
      segments.push({
        text: value.slice(lastIndex, span.start),
        isGlyph: false,
      })
    }
    segments.push({ text: value.slice(span.start, span.end), isGlyph: true })
    lastIndex = span.end
  }
  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex), isGlyph: false })
  }
  return segments
}

/** Check if a value contains any glyph references. */
export function containsGlyphs(value: string): boolean {
  return findGlyphSpans(value).length > 0
}

/**
 * Extract the inner expression from a `${...}` reference.
 *
 * For a plain reference like `${runId}` this is the variable name; for a
 * Jinja expression like `${var | sub_days(2)}` it's the full body. Callers
 * that need just the leading variable name should parse further.
 */
export function extractGlyphKey(ref: string): string {
  return ref.slice(2, -1)
}
