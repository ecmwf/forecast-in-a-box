/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Helpers for deriving external links from a plugin's metadata. */

/** PyPI project URL for a plugin, derived from its pip source; null when none. */
export function getPyPIUrl(pipSource: string | null): string | null {
  if (!pipSource) return null
  const packageName = pipSource.split('/').pop()?.replace('.git', '')
  return packageName ? `https://pypi.org/project/${packageName}` : null
}
