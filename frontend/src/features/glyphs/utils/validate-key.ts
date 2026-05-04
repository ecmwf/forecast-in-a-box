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
 * Glyph key (variable name) validator.
 *
 * A glyph key has to be a valid Python identifier so that ${key} parses as a
 * single name rather than a Jinja expression. ${a-b}, for example, is parsed
 * by Jinja as the binary expression `a - b` (subtraction), which surfaces
 * later as a confusing "unknown glyph" error on whichever block uses it.
 * Rejecting the bad key at form time is much clearer than catching it
 * downstream.
 *
 * Allowed: letters, digits, underscore. Must start with a letter or underscore
 * (no leading digits). Same rule for global glyphs (admin page) and local
 * glyphs (fable variables panel).
 */
const VALID_GLYPH_KEY = /^[A-Za-z_]\w*$/

export function isValidGlyphKey(key: string): boolean {
  return VALID_GLYPH_KEY.test(key)
}
