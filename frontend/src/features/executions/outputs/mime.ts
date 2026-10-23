/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Parsing for backend output mimes. */

/** Value of a mime parameter. */
export function mimeParam(mime: string, key: string): string | undefined {
  for (const part of mime.split(';').slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim().toLowerCase() === key) {
      return part.slice(eq + 1).trim()
    }
  }
  return undefined
}

/** Base type plus fiab-format only. */
export function canonicalMime(mime: string): string {
  const base = mime.split(';', 1)[0].trim().toLowerCase()
  const format = mimeParam(mime, 'fiab-format')
  return format ? `${base}; fiab-format=${format}` : base
}
