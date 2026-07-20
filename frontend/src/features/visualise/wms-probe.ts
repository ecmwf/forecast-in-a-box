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
 * source. The pasted URL is kept VERBATIM (path and query included —
 * real-world endpoints look like `https://eccharts.ecmwf.int/wms/?token=…`
 * or `…/geoserver/ows`); only a bare origin gets `/wms` appended (the
 * lens convention), via toWmsEndpoint. Errors are distinguishable so the
 * form can be actionable: bad input, an HTTP error status (reachable
 * server rejecting the request — wrong path or token), a non-WMS
 * response, or a network/CORS failure (indistinguishable in a browser).
 */

import {
  appendWmsParams,
  parseCapabilities,
  toWmsEndpoint,
} from '@/features/viewer/wms-capabilities'
import { wmsCapabilitiesKey } from '@/features/viewer/hooks/useLensSource'
import { queryClient } from '@/lib/queryClient'

export type WmsProbeResult =
  | { ok: true; baseUrl: string; label: string }
  | { ok: false; reason: 'invalid-url' | 'unreachable' | 'parse' | 'timeout' }
  | { ok: false; reason: 'http'; status: number }

// Generous: real met-service capabilities run to MBs and 20+ seconds.
const PROBE_TIMEOUT_MS = 30_000

export async function probeWmsEndpoint(
  raw: string,
  { timeoutMs = PROBE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<WmsProbeResult> {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid-url' }
  }
  const baseUrl = parsed.toString()

  try {
    const res = await fetch(
      appendWmsParams(
        toWmsEndpoint(baseUrl),
        'service=WMS&version=1.3.0&request=GetCapabilities',
      ),
      { signal: AbortSignal.timeout(timeoutMs) },
    )
    if (!res.ok) return { ok: false, reason: 'http', status: res.status }
    const xml = await res.text()
    try {
      // Seed the capabilities cache — activating the source is instant
      // instead of re-downloading a multi-MB document.
      queryClient.setQueryData(
        wmsCapabilitiesKey(baseUrl),
        parseCapabilities(xml),
      )
    } catch {
      return { ok: false, reason: 'parse' }
    }
    return { ok: true, baseUrl, label: parsed.host }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, reason: 'timeout' }
    }
    // Network failure or CORS rejection — the browser can't tell them apart.
    return { ok: false, reason: 'unreachable' }
  }
}
