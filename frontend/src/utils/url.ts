/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** URL safety helpers for backend-supplied values rendered into hrefs. */

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:'])

/** True when `url` is an absolute http(s) URL — blocks `javascript:` etc. */
export function isHttpUrl(url: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}
