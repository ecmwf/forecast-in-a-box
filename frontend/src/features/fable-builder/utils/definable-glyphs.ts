/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Drop names the backend rejected outright: offering to define a glyph whose
 * name it refuses is an action that can never succeed. */
export function definableGlyphs(
  missingGlyphs: Record<string, ReadonlyArray<string>> | null,
  invalidGlyphNames: ReadonlyArray<string>,
): Record<string, Array<string>> | null {
  if (!missingGlyphs || invalidGlyphNames.length === 0) {
    return missingGlyphs as Record<string, Array<string>> | null
  }
  const invalid = new Set(invalidGlyphNames)
  const out: Record<string, Array<string>> = {}
  for (const [configKey, names] of Object.entries(missingGlyphs)) {
    const kept = names.filter((name) => !invalid.has(name))
    if (kept.length > 0) out[configKey] = kept
  }
  return out
}
