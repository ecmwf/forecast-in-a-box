/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The user's ECMWF key, swapped into ecCharts URLs where requests are built. */

export const ECCHARTS_HOST = 'eccharts.ecmwf.int'
export const ECMWF_KEY_PAGE_URL = 'https://api.ecmwf.int/v1/key/'
const PUBLIC_TOKEN = 'public'

function ecchartsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.host === ECCHARTS_HOST ? parsed : null
  } catch {
    return null
  }
}

/** Public ecCharts URLs carry the key instead; a pasted private token wins. */
export function withEcmwfKey(url: string, key: string | null): string {
  if (!key) return url
  const parsed = ecchartsUrl(url)
  if (!parsed) return url
  const token = parsed.searchParams.get('token')
  if (token !== null && token !== PUBLIC_TOKEN) return url
  parsed.searchParams.set('token', key)
  return parsed.toString()
}

/** The keyed URL folded back to its public form (scopes, display). */
export function ecmwfPublicUrl(url: string): string {
  const parsed = ecchartsUrl(url)
  if (!parsed?.searchParams.has('token')) return url
  parsed.searchParams.set('token', PUBLIC_TOKEN)
  return parsed.toString()
}

/** Last characters for a "key ending in …" display. */
export const keyTail = (key: string): string => key.slice(-4)
