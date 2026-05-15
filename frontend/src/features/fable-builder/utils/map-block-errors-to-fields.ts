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
 * Best-effort mapping from backend block-level error strings to individual
 * config keys. The backend returns block errors as flat strings, so the
 * frontend parses known message shapes to provide per-field UI highlights.
 * Unknown-glyph references arrive structured (not as strings) and are
 * attributed via the optional `missingGlyphs` parameter.
 */

export interface MappedBlockErrors {
  /** Field-level errors keyed by configuration option key. */
  byConfigKey: Record<string, Array<string>>
  /** Errors that could not be attributed to a specific field. */
  unmapped: Array<string>
}

/** Pre-translated messages — callers resolve via i18next so this util stays pure. */
export interface FieldErrorMessages {
  unknownConfigKey: string
  missingRequiredValue: string
  unknownGlyph: (name: string) => string
}

/**
 * Parse a Python-style set-of-strings literal like `{'foo', 'bar'}` into
 * a Set<string>. Returns null if parsing fails.
 */
function parsePythonStringSet(input: string): Set<string> | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null

  const inner = trimmed.slice(1, -1).trim()
  if (inner === '') return new Set()

  const names = new Set<string>()
  // Python repr uses single quotes by default; also accept double quotes.
  const itemPattern = /['"]([^'"]*)['"]/g
  let match: RegExpExecArray | null
  while ((match = itemPattern.exec(inner)) !== null) {
    names.add(match[1])
  }
  return names.size > 0 ? names : null
}

function pushError(
  out: Record<string, Array<string>>,
  configKey: string,
  message: string,
): void {
  const existing = (out as Record<string, Array<string> | undefined>)[configKey]
  if (existing) {
    existing.push(message)
  } else {
    out[configKey] = [message]
  }
}

/**
 * Map block-level backend errors and structured missing glyphs onto specific
 * configuration keys.
 *
 * Recognised `errors` shapes (Python-set literals):
 * - "Block contains extra config: {...}" → messages.unknownConfigKey
 * - "Block contains missing config: {...}" → messages.missingRequiredValue
 *
 * `missingGlyphs[configKey] = [name, ...]` → messages.unknownGlyph(name) per name.
 * Anything else in `errors` is returned as `unmapped`.
 */
export function mapBlockErrorsToFields(
  errors: ReadonlyArray<string>,
  missingGlyphs: Record<string, ReadonlyArray<string>>,
  messages: FieldErrorMessages,
): MappedBlockErrors {
  const byConfigKey: Record<string, Array<string>> = {}
  const unmapped: Array<string> = []

  for (const error of errors) {
    const extraConfig = error.match(/^Block contains extra config:\s*(.+)$/)
    if (extraConfig) {
      const set = parsePythonStringSet(extraConfig[1])
      if (!set || set.size === 0) {
        unmapped.push(error)
        continue
      }
      for (const key of set) {
        pushError(byConfigKey, key, messages.unknownConfigKey)
      }
      continue
    }

    const missingConfig = error.match(/^Block contains missing config:\s*(.+)$/)
    if (missingConfig) {
      const set = parsePythonStringSet(missingConfig[1])
      if (!set || set.size === 0) {
        unmapped.push(error)
        continue
      }
      for (const key of set) {
        pushError(byConfigKey, key, messages.missingRequiredValue)
      }
      continue
    }

    unmapped.push(error)
  }

  for (const [configKey, glyphNames] of Object.entries(missingGlyphs)) {
    for (const name of glyphNames) {
      pushError(byConfigKey, configKey, messages.unknownGlyph(name))
    }
  }

  return { byConfigKey, unmapped }
}
