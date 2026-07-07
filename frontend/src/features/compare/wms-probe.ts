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
 * Validate an external WMS endpoint before adding it as a comparison
 * source: normalize the URL to the viewer's base form (no trailing
 * slash / `/wms` suffix — the viewer appends `/wms` itself), then fetch
 * and parse GetCapabilities. Distinguishes bad input, unreachable/CORS
 * failures (indistinguishable from the browser), and non-WMS responses so
 * the form can give actionable errors.
 */

import { parseCapabilities } from '@/features/viewer/wms-capabilities'

export type WmsProbeResult =
  | { ok: true; baseUrl: string; label: string }
  | { ok: false; reason: 'invalid-url' | 'unreachable' | 'parse' }

export async function probeWmsEndpoint(raw: string): Promise<WmsProbeResult> {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid-url' }
  }
  const baseUrl = parsed
    .toString()
    .replace(/\/+$/, '')
    .replace(/\/wms$/i, '')

  try {
    const res = await fetch(
      `${baseUrl}/wms?service=WMS&version=1.3.0&request=GetCapabilities`,
    )
    if (!res.ok) return { ok: false, reason: 'unreachable' }
    const xml = await res.text()
    try {
      parseCapabilities(xml)
    } catch {
      return { ok: false, reason: 'parse' }
    }
    return { ok: true, baseUrl, label: parsed.host }
  } catch {
    // Network failure or CORS rejection — the browser can't tell them apart.
    return { ok: false, reason: 'unreachable' }
  }
}
