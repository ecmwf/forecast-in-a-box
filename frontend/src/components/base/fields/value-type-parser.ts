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
 * Value Type Parser
 *
 * Parses backend value_type strings into structured types for dynamic field rendering.
 *
 * Supported value types:
 * - str → string input
 * - int → number input (step=1)
 * - float → number input (step=any)
 * - datetime → datetime-local input
 * - date-iso8601 → date input
 * - list[str] → tag input (badges with add/remove)
 * - enum['a','b','c'] → select dropdown
 */

export type ParsedValueType =
  | { type: 'string' }
  | { type: 'int' }
  | { type: 'float' }
  | { type: 'datetime' }
  | { type: 'date' }
  | { type: 'list'; itemType: 'string' }
  | { type: 'enum'; options: Array<string> }
  | { type: 'unknown'; raw: string }

/**
 * Parse a value_type string from the backend catalogue into a structured type
 */
export function parseValueType(valueType: string | undefined): ParsedValueType {
  if (!valueType) {
    return { type: 'string' }
  }

  const normalized = valueType.trim().toLowerCase()

  // Simple types
  if (normalized === 'str' || normalized === 'string') {
    return { type: 'string' }
  }

  if (normalized === 'int' || normalized === 'integer') {
    return { type: 'int' }
  }

  if (normalized === 'float' || normalized === 'number') {
    return { type: 'float' }
  }

  if (normalized === 'datetime') {
    return { type: 'datetime' }
  }

  if (normalized === 'date-iso8601' || normalized === 'date') {
    return { type: 'date' }
  }

  // List type: list[str]
  const listMatch = valueType.match(/^list\[(\w+)\]$/i)
  if (listMatch) {
    const itemType = listMatch[1].toLowerCase()
    if (itemType === 'str' || itemType === 'string') {
      return { type: 'list', itemType: 'string' }
    }
    // For now, only support list[str]
    return { type: 'unknown', raw: valueType }
  }

  // Enum type: enum['a','b','c'] or enum["a","b","c"]
  const enumMatch = valueType.match(/^enum\[(.+)\]$/i)
  if (enumMatch) {
    const optionsStr = enumMatch[1]
    const options = parseEnumOptions(optionsStr)
    if (options.length > 0) {
      return { type: 'enum', options }
    }
  }

  return { type: 'unknown', raw: valueType }
}

/**
 * Parse enum options from a string like "'a','b','c'" or '"a","b","c"'
 */
function parseEnumOptions(optionsStr: string): Array<string> {
  const options: Array<string> = []

  // Match quoted strings (single or double quotes)
  const regex = /['"]([^'"]+)['"]/g
  let match

  while ((match = regex.exec(optionsStr)) !== null) {
    options.push(match[1])
  }

  return options
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
      // Return current datetime in ISO format for datetime-local input
      return new Date().toISOString().slice(0, 16)
    case 'date':
      // Return current date in YYYY-MM-DD format
      return new Date().toISOString().slice(0, 10)
    case 'list':
      return ''
    case 'enum':
      return parsedType.options[0] ?? ''
    case 'unknown':
      return ''
  }
}
