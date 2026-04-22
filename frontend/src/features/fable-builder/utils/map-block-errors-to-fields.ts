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
 * config keys. The backend currently returns block errors as flat strings
 * (see backend/src/forecastbox/domain/blueprint/service.py), so the frontend
 * parses known message shapes to provide per-field UI highlights.
 */

import {
  containsGlyphs,
  extractGlyphKey,
} from '@/features/fable-builder/utils/glyph-display'

export interface MappedBlockErrors {
  /** Field-level errors keyed by configuration option key. */
  byConfigKey: Record<string, Array<string>>
  /** Errors that could not be attributed to a specific field. */
  unmapped: Array<string>
}

const GLYPH_PATTERN = /\$\{(\w+)\}/g

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

/**
 * Return the set of glyph names referenced inside a config value
 * (e.g. `${runId}-foo` → {"runId"}).
 */
function referencedGlyphs(value: string): Set<string> {
  const names = new Set<string>()
  if (!containsGlyphs(value)) return names
  for (const match of value.matchAll(GLYPH_PATTERN)) {
    names.add(extractGlyphKey(match[0]))
  }
  return names
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
 * Map block-level backend errors onto specific configuration keys.
 *
 * Recognised message shapes:
 * - "Unknown glyphs referenced: {'foo', 'bar'}" — each unknown glyph is
 *   attached to every config key whose value references it.
 * - "Block contains extra config: {'foo', 'bar'}" — attached as "Unknown
 *   configuration key" to each listed key.
 * - "Block contains missing config: {'foo', 'bar'}" — attached as
 *   "Missing required value" to each listed key.
 *
 * Everything else is returned as `unmapped`.
 */
export function mapBlockErrorsToFields(
  errors: ReadonlyArray<string>,
  configurationValues: Record<string, string>,
): MappedBlockErrors {
  const byConfigKey: Record<string, Array<string>> = {}
  const unmapped: Array<string> = []

  for (const error of errors) {
    const unknownGlyphs = error.match(/^Unknown glyphs referenced:\s*(.+)$/)
    if (unknownGlyphs) {
      const set = parsePythonStringSet(unknownGlyphs[1])
      if (!set || set.size === 0) {
        unmapped.push(error)
        continue
      }
      let attributed = false
      for (const [configKey, value] of Object.entries(configurationValues)) {
        const refs = referencedGlyphs(value)
        for (const name of refs) {
          if (set.has(name)) {
            pushError(byConfigKey, configKey, `Unknown glyph: \${${name}}`)
            attributed = true
          }
        }
      }
      if (!attributed) {
        unmapped.push(error)
      }
      continue
    }

    const extraConfig = error.match(/^Block contains extra config:\s*(.+)$/)
    if (extraConfig) {
      const set = parsePythonStringSet(extraConfig[1])
      if (!set || set.size === 0) {
        unmapped.push(error)
        continue
      }
      for (const key of set) {
        pushError(byConfigKey, key, 'Unknown configuration key')
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
        pushError(byConfigKey, key, 'Missing required value')
      }
      continue
    }

    unmapped.push(error)
  }

  return { byConfigKey, unmapped }
}
