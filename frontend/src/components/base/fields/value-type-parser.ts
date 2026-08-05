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
 * Value Type Parser — widget projection over the FableType grammar.
 *
 * fable-type.ts owns the wire grammar (parse/serialize); this module
 * flattens a parsed type onto the field widgets:
 *
 * - str → string input
 * - int → number input (step=1)
 * - float → number input (step=any)
 * - datetime → datetime-local input
 * - date (legacy alias date-iso8601) → date input
 * - list[str] / list[int] → tag input (badges with add/remove)
 * - enum[str]('a','b','c') → select dropdown (open: suggestions, accept any string)
 * - enumClosed[str]('a','b','c') → select dropdown (closed: must be one of the listed)
 * - list[enumClosed[str]('a','b')] → multi-select restricted to the listed items
 * - list[enum[str]('a','b')] → multi-select with suggestions, accept any string
 * - geodomain → geographic-area picker (presets / countries / draw a box)
 * - artifact → string input (catalog lookup / richer UI not yet implemented)
 * - param → string input (param name lookup not yet implemented)
 * - optional[T] → same widget as T, with optional=true flag (legacy — the
 *   current backend grammar has no optional wrapper)
 *
 * `enum`/`enumList` carry `closed: boolean` (closed vs open);
 * anemoiSource's `input_source` ships the open form.
 *
 * str/int/float/artifact/param enum subtypes render as selects over the wire strings;
 * anything else the grammar knows but no widget exists for (other enum
 * subtypes, union, bboxWSEN, …) falls back to `unknown`.
 */

import { parseFableType } from './fable-type'
import type { FableType } from './fable-type'
import { getAppTimeZone, todayInZone } from '@/lib/datetime'

export type ParsedValueType =
  | { type: 'string'; optional?: boolean }
  | { type: 'int'; optional?: boolean }
  | { type: 'float'; optional?: boolean }
  | { type: 'datetime'; optional?: boolean }
  | { type: 'date'; optional?: boolean }
  | { type: 'list'; itemType: 'string'; optional?: boolean }
  | { type: 'list'; itemType: 'int'; optional?: boolean }
  | {
      type: 'enum'
      options: Array<string>
      /** `enumClosed[…]` ⇒ true (must be in `options`); `enum[…]` ⇒ false. */
      closed: boolean
      optional?: boolean
    }
  | {
      type: 'enumList'
      options: Array<string>
      /** `list[enumClosed[…]]` ⇒ true; `list[enum[…]]` ⇒ false. */
      closed: boolean
      optional?: boolean
    }
  | { type: 'geodomain'; optional?: boolean }
  | { type: 'unknown'; raw: string; optional?: boolean }

/**
 * Parse a value_type string from the backend catalogue into a structured type
 */
export function parseValueType(valueType: string | undefined): ParsedValueType {
  if (!valueType) {
    return { type: 'string' }
  }

  const trimmed = valueType.trim()

  // Legacy optional wrapper: unwrap "optional[<inner>]" and mark the result
  // optional. Recurses so optional[int], optional[enum[...]] etc. all work.
  const optionalMatch = trimmed.match(/^optional\[(.+)\]$/i)
  if (optionalMatch) {
    const inner = parseValueType(optionalMatch[1])
    return { ...inner, optional: true }
  }

  const parsed = parseFableType(trimmed)
  return parsed ? flatten(parsed, trimmed) : { type: 'unknown', raw: trimmed }
}

/** str/int/float/artifact/param enums render as selects over the wire
 *  strings — artifact/param members serialize quoted like str items. */
function isSelectEnum(t: FableType): t is Extract<FableType, { kind: 'enum' }> {
  return (
    t.kind === 'enum' &&
    (t.subtype.kind === 'str' ||
      t.subtype.kind === 'int' ||
      t.subtype.kind === 'float' ||
      t.subtype.kind === 'artifact' ||
      t.subtype.kind === 'param')
  )
}

function flatten(t: FableType, raw: string): ParsedValueType {
  switch (t.kind) {
    case 'str':
      return { type: 'string' }
    // Reserved for future catalog/param lookups — plain strings until then.
    case 'artifact':
    case 'param':
      return { type: 'string' }
    case 'int':
      return { type: 'int' }
    case 'float':
      return { type: 'float' }
    case 'datetime':
      return { type: 'datetime' }
    case 'date':
      return { type: 'date' }
    case 'geodomain':
      return { type: 'geodomain' }
    case 'enum':
      if (isSelectEnum(t)) {
        return { type: 'enum', options: t.items.map(String), closed: t.closed }
      }
      return { type: 'unknown', raw }
    case 'list':
      if (t.item.kind === 'str') return { type: 'list', itemType: 'string' }
      if (t.item.kind === 'int') return { type: 'list', itemType: 'int' }
      if (isSelectEnum(t.item)) {
        return {
          type: 'enumList',
          options: t.item.items.map(String),
          closed: t.item.closed,
        }
      }
      return { type: 'unknown', raw }
    // Grammar-valid but widget-less: geodomainSingle, bboxWSEN, union.
    default:
      return { type: 'unknown', raw }
  }
}

/**
 * Get a default value for a parsed value type
 */
export function getDefaultValueForType(parsedType: ParsedValueType): string {
  switch (parsedType.type) {
    case 'string':
      return ''
    case 'int':
      return '0'
    case 'float':
      return '0.0'
    case 'datetime':
      // Canonical value is naive UTC — default to today's 00:00 UTC (00z run).
      return `${todayInZone('UTC')}T00:00:00`
    case 'date':
      // A calendar date has no instant; use "today" in the app timezone.
      return todayInZone(getAppTimeZone())
    case 'list':
      return ''
    case 'enum':
      return parsedType.options[0] ?? ''
    case 'enumList':
      return ''
    case 'geodomain':
      return ''
    case 'unknown':
      return ''
  }
}
