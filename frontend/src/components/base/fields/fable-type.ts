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
 * FableType — TypeScript mirror of fiab-core's value-type grammar
 * (backend types.py). The wire string is the source of truth; this module
 * gives it a typed shape with `serializeValueType`/`parseFableType` as a
 * round-trip pair. Mocks and fixtures build value_type strings through the
 * factories so a wire-syntax change is one function edit, not a string
 * hunt (see the #570 enum migration).
 *
 * Parsing is a tolerant superset of the backend `_parse`: keywords are
 * case-insensitive and legacy aliases (`string`, `integer`, `number`,
 * `date-iso8601`) normalize to canonical kinds. Serialization is always
 * canonical. `optional[T]` is NOT part of this grammar anymore — the
 * legacy widget projection in value-type-parser.ts still peels it.
 */

export type FableType =
  | { kind: 'str' }
  | { kind: 'int' }
  | { kind: 'float' }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'geodomain' }
  | { kind: 'geodomainSingle' }
  | { kind: 'bboxWSEN' }
  | { kind: 'artifact' }
  | { kind: 'param' }
  | {
      kind: 'enum'
      closed: boolean
      subtype: FableType
      /** Wire items; numbers for numeric subtypes (quoting follows the item type). */
      items: ReadonlyArray<string | number>
    }
  | { kind: 'list'; item: FableType }
  | { kind: 'union'; types: ReadonlyArray<FableType> }

// -------- Factories (mirror the backend constructors) --------

export const stringType: FableType = { kind: 'str' }
export const intType: FableType = { kind: 'int' }
export const floatType: FableType = { kind: 'float' }
export const dateType: FableType = { kind: 'date' }
export const datetimeType: FableType = { kind: 'datetime' }
export const geodomainType: FableType = { kind: 'geodomain' }
export const artifactType: FableType = { kind: 'artifact' }
export const paramType: FableType = { kind: 'param' }

function inferSubtype(items: ReadonlyArray<string | number>): FableType {
  if (items.length > 0 && items.every((i) => typeof i === 'number')) {
    return items.every((i) => Number.isInteger(i)) ? intType : floatType
  }
  return stringType
}

export function closedEnum(
  items: ReadonlyArray<string | number>,
  subtype?: FableType,
): FableType {
  return {
    kind: 'enum',
    closed: true,
    subtype: subtype ?? inferSubtype(items),
    items,
  }
}

export function openEnum(
  items: ReadonlyArray<string | number>,
  subtype?: FableType,
): FableType {
  return {
    kind: 'enum',
    closed: false,
    subtype: subtype ?? inferSubtype(items),
    items,
  }
}

export function listOf(item: FableType): FableType {
  return { kind: 'list', item }
}

export function unionOf(types: ReadonlyArray<FableType>): FableType {
  return { kind: 'union', types }
}

// -------- Serialization (mirrors FableType.serialize) --------

/** Quote rule mirrors the backend `_serialize_enum_item`: strings quoted, numbers raw. */
function serializeEnumItem(item: string | number): string {
  return typeof item === 'string' ? `'${item}'` : String(item)
}

export function serializeValueType(t: FableType): string {
  switch (t.kind) {
    case 'str':
      return 'str'
    case 'int':
      return 'int'
    case 'float':
      return 'float'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'geodomain':
      return 'geodomain'
    case 'geodomainSingle':
      return 'geodomainSingle'
    case 'bboxWSEN':
      return 'bboxWSEN'
    case 'artifact':
      return 'artifact'
    case 'param':
      return 'param'
    case 'enum': {
      const keyword = t.closed ? 'enumClosed' : 'enumOpen'
      const items = t.items.map(serializeEnumItem).join(',')
      return `${keyword}[${serializeValueType(t.subtype)}](${items})`
    }
    case 'list':
      return `list[${serializeValueType(t.item)}]`
    case 'union':
      return `union[${t.types.map(serializeValueType).join(',')}]`
  }
}

// -------- Parsing (mirrors the backend `_parse` remainder-threading) --------

/** Longest-first so aliases win over their prefixes (`string` before `str`). */
const ATOMS: ReadonlyArray<[keyword: string, kind: FableType]> = [
  ['geodomainsingle', { kind: 'geodomainSingle' }],
  ['date-iso8601', dateType],
  ['geodomain', geodomainType],
  ['datetime', datetimeType],
  ['bboxwsen', { kind: 'bboxWSEN' }],
  ['artifact', artifactType],
  ['integer', intType],
  ['string', stringType],
  ['number', floatType],
  ['param', paramType],
  ['float', floatType],
  ['date', dateType],
  ['int', intType],
  ['str', stringType],
]

const ENUM_KEYWORDS: ReadonlyArray<[keyword: string, closed: boolean]> = [
  ['enumclosed', true],
  ['enumopen', false],
  // Legacy alias — the backend never emits bare `enum`.
  ['enum', false],
]

/** Split `[inner]remainder` / `(inner)remainder` at the matching delimiter. */
function splitDelimited(
  s: string,
  open: string,
  close: string,
): [inner: string, remainder: string] | null {
  if (!s.startsWith(open)) return null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === open) depth++
    else if (s[i] === close && --depth === 0) {
      return [s.slice(1, i), s.slice(i + 1)]
    }
  }
  return null
}

function stripQuotes(token: string): string {
  if (
    token.length >= 2 &&
    token[0] === token[token.length - 1] &&
    (token[0] === "'" || token[0] === '"')
  ) {
    return token.slice(1, -1)
  }
  return token
}

const NUMERIC_ITEM = /^-?\d+(\.\d+)?$/

function parseEnumItems(
  itemsStr: string,
  subtype: FableType,
): Array<string | number> {
  const numeric = subtype.kind === 'int' || subtype.kind === 'float'
  return itemsStr
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map(stripQuotes)
    .map((token) =>
      numeric && NUMERIC_ITEM.test(token) ? Number(token) : token,
    )
}

/** Parse a type from the start of `s`; returns the type and the unparsed tail. */
function parsePrefix(s: string): [FableType, string] | null {
  const input = s.replace(/^\s+/, '')
  const lower = input.toLowerCase()

  if (lower.startsWith('list[')) {
    const split = splitDelimited(input.slice(4), '[', ']')
    if (!split) return null
    const inner = parsePrefix(split[0])
    if (!inner || inner[1].trim()) return null
    return [{ kind: 'list', item: inner[0] }, split[1]]
  }

  if (lower.startsWith('union[')) {
    const split = splitDelimited(input.slice(5), '[', ']')
    if (!split) return null
    const types: Array<FableType> = []
    let remaining = split[0]
    while (remaining.trim()) {
      if (types.length > 0) {
        if (!remaining.startsWith(',')) return null
        remaining = remaining.slice(1)
      }
      const member = parsePrefix(remaining)
      if (!member) return null
      types.push(member[0])
      remaining = member[1].replace(/^\s+/, '')
    }
    if (types.length === 0) return null
    return [{ kind: 'union', types }, split[1]]
  }

  for (const [keyword, closed] of ENUM_KEYWORDS) {
    if (!lower.startsWith(`${keyword}[`)) continue
    const bracket = splitDelimited(input.slice(keyword.length), '[', ']')
    if (!bracket) return null
    const subtypeParsed = parsePrefix(bracket[0])
    if (!subtypeParsed || subtypeParsed[1].trim()) return null
    const paren = splitDelimited(bracket[1].replace(/^\s+/, ''), '(', ')')
    if (!paren) return null
    const items = parseEnumItems(paren[0], subtypeParsed[0])
    if (items.length === 0) return null
    return [
      { kind: 'enum', closed, subtype: subtypeParsed[0], items },
      paren[1],
    ]
  }

  for (const [keyword, kind] of ATOMS) {
    if (lower.startsWith(keyword)) return [kind, input.slice(keyword.length)]
  }

  return null
}

/** Parse a complete value_type expression; null when it is not FableType grammar. */
export function parseFableType(expr: string): FableType | null {
  const parsed = parsePrefix(expr)
  if (!parsed || parsed[1].trim()) return null
  return parsed[0]
}
