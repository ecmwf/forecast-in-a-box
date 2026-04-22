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
 * Glyph-expression cursor classifier.
 *
 * Given the text of a field and a cursor offset, decides whether the user is
 * positioned to receive autocomplete suggestions inside a `${...}` Jinja
 * expression and — if so — which kind of candidate list to show:
 *
 *   - `value`: variable names and callable globals (e.g. `timedelta(...)`)
 *   - `filter`: pipe-style filters (e.g. `${dt | add_days}`)
 *   - `none`:  not inside an open `${...}`, inside a string literal, in a
 *              nested `${...}` (unsupported by Jinja), or right after a
 *              completed value with no separator.
 *
 * The classifier tokenises only enough of the expression to follow paren
 * depth, pipe boundaries, and string literals; it does NOT evaluate or fully
 * parse Jinja syntax.
 */

export type GlyphContextKind = 'value' | 'filter' | 'none'

export interface GlyphContext {
  kind: GlyphContextKind
  /** Identifier already typed at the cursor; used to filter the candidate list. */
  prefix: string
  /** Inclusive start of the range a picked candidate should replace. */
  replaceStart: number
  /** Exclusive end of that range (always the cursor offset). */
  replaceEnd: number
}

const NONE: GlyphContext = {
  kind: 'none',
  prefix: '',
  replaceStart: 0,
  replaceEnd: 0,
}

const isWordStart = (c: string): boolean => /[a-zA-Z_]/.test(c)
const isWordChar = (c: string): boolean => /[a-zA-Z0-9_]/.test(c)
const isOperator = (c: string): boolean => '+-*/=<>'.includes(c)

/**
 * Find the innermost open `${` whose matching `}` lies at or beyond the cursor.
 * Returns -1 if the cursor is not inside any `${...}`, or -2 if a nested `${`
 * is detected (we don't try to autocomplete inside nested substitutions —
 * Jinja expressions can't actually nest the `${...}` delimiter anyway).
 */
function findOpenSubstitution(text: string, cursor: number): number {
  let openIdx = -1
  let i = 0
  while (i < cursor) {
    if (text[i] === '$' && text[i + 1] === '{') {
      if (openIdx !== -1) return -2
      openIdx = i + 2
      i += 2
      continue
    }
    if (text[i] === '}' && openIdx !== -1) {
      openIdx = -1
    }
    i++
  }
  return openIdx
}

/**
 * `'closed'` is an internal state meaning "we just consumed a complete value
 * or filter and have not seen a separator that would re-open autocomplete";
 * it never escapes — it maps to `'none'` at the public boundary.
 */
type FrameKind = 'value' | 'filter' | 'closed'

export function parseGlyphContext(text: string, cursor: number): GlyphContext {
  const openIdx = findOpenSubstitution(text, cursor)
  if (openIdx < 0) return NONE

  // Stack of paren frames. Each frame's `kind` tracks what's currently
  // expected at that paren depth. `value` at depth 0 is the initial state of
  // a fresh `${` expression.
  const stack: Array<{ kind: FrameKind }> = [{ kind: 'value' }]
  const top = (): { kind: FrameKind } => stack[stack.length - 1]

  let identifier = ''
  let identifierStart = openIdx
  // Frame kind captured the moment the current identifier started, so we can
  // still report `value`/`filter` even though `top().kind` is set to `closed`
  // immediately after the identifier ends.
  let kindBeforeIdentifier: FrameKind = 'value'

  let i = openIdx
  while (i < cursor) {
    const c = text[i]

    // Mid-identifier: keep accumulating until a non-word char appears.
    if (identifier !== '') {
      if (isWordChar(c)) {
        identifier += c
        i++
        continue
      }
      // Identifier just terminated. Mark frame as closed and fall through
      // to the separator-handling switch below WITHOUT advancing `i`.
      identifier = ''
      top().kind = 'closed'
    }

    if (c === "'" || c === '"') {
      const quote = c
      i++ // skip opening quote
      while (i < cursor && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < cursor) i++ // escape
        i++
      }
      if (i >= cursor) return NONE // cursor sits inside an unterminated string
      i++ // skip closing quote
      top().kind = 'closed'
      continue
    }

    if (isWordStart(c)) {
      // Refuse to start a new identifier when the frame is already closed
      // (e.g. `${a b` — two adjacent identifiers separated by whitespace).
      if (top().kind === 'closed') return NONE
      identifier = c
      identifierStart = i
      kindBeforeIdentifier = top().kind
      i++
      continue
    }

    if (c === '$' && text[i + 1] === '{') return NONE

    if (c === '|') {
      top().kind = 'filter'
      i++
    } else if (c === '(') {
      stack.push({ kind: 'value' })
      i++
    } else if (c === ')') {
      if (stack.length > 1) stack.pop()
      top().kind = 'closed'
      i++
    } else if (c === ',') {
      top().kind = 'value'
      i++
    } else if (isOperator(c)) {
      top().kind = 'value'
      i++
    } else if (c === ' ' || c === '\t') {
      i++
    } else {
      // Unknown / unsupported char — bail out.
      return NONE
    }
  }

  if (identifier !== '') {
    if (kindBeforeIdentifier === 'closed') return NONE
    return {
      kind: kindBeforeIdentifier,
      prefix: identifier,
      replaceStart: identifierStart,
      replaceEnd: cursor,
    }
  }

  const finalKind = top().kind
  if (finalKind === 'closed') return NONE
  return {
    kind: finalKind,
    prefix: '',
    replaceStart: cursor,
    replaceEnd: cursor,
  }
}
