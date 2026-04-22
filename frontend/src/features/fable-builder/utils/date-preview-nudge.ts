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
 * Helpers for the "this is a date field but your expression resolves to a
 * datetime" nudge shown under a glyph-backed field preview.
 *
 * Kept as pure utilities so they're easy to unit-test without rendering the
 * wrapper component or mocking i18n.
 */

import { findGlyphSpans } from '@/features/fable-builder/utils/glyph-display'

/** Match `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`; seconds optional. */
const DATETIME_RE = /\b\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})(?::(\d{2}))?/

/**
 * Return true if `preview` looks like a datetime with a NON-ZERO time
 * component. Plain `YYYY-MM-DD` and any form where the time is exactly
 * midnight (`00:00`, `00:00:00`) return false — those are considered
 * date-equivalent so the nudge doesn't linger after the user applies the
 * `| floor_day` fix.
 */
export function previewHasTimeComponent(preview: string): boolean {
  const match = DATETIME_RE.exec(preview)
  if (!match) return false
  const hh = match[1]
  const mm = match[2]
  // `match[3]` is typed as string but is actually optional (the `(\d{2})?`
  // group in the regex). Cast so the undefined-check isn't flagged as dead.
  const ss = match[3] as string | undefined
  if (hh === '00' && mm === '00' && (ss === undefined || ss === '00')) {
    return false
  }
  return true
}

/**
 * Return true if the value contains exactly one `${...}` span that spans the
 * whole string. That's the only shape where we can safely apply the fix
 * without guessing which substitution is the "date-producing" one.
 */
export function canApplyFloorDay(value: string): boolean {
  const spans = findGlyphSpans(value)
  if (spans.length !== 1) return false
  const [span] = spans
  if (span.start !== 0 || span.end !== value.length) return false
  if (alreadyHasFloorDay(value)) return false
  return true
}

/**
 * Append `| floor_day` to the single `${...}` substitution in `value`. Leaves
 * any trailing filters on top of their existing chain
 * (`${dt | sub_days(2)}` → `${dt | sub_days(2) | floor_day}`) so the final
 * result is truncated to midnight regardless of what precedes.
 *
 * Idempotent: does nothing if `canApplyFloorDay(value)` is false.
 */
export function applyFloorDay(value: string): string {
  if (!canApplyFloorDay(value)) return value
  const body = value.slice(2, -1) // content between `${` and `}`
  return `\${${body} | floor_day}`
}

function alreadyHasFloorDay(value: string): boolean {
  return /\|\s*floor_day\b/.test(value)
}
