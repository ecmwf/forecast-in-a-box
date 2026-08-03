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
 * form can be actionable: a CSP-disallowed host (caught before fetching —
 * a CSP block rejects exactly like a network error), bad input, an HTTP
 * error status (reachable server rejecting the request — wrong path or
 * token), a non-WMS response, or a network/CORS failure (indistinguishable
 * in a browser).
 */

import { cspConnectPolicy } from './deployment'
import type { CapabilitiesLimits } from '@/features/viewer/wms-capabilities'
import {
  CapabilitiesError,
  fetchCapabilities,
} from '@/features/viewer/wms-capabilities'
import { wmsCapabilitiesKey } from '@/features/viewer/hooks/useLensSource'
import { queryClient } from '@/lib/queryClient'

export type WmsProbeResult =
  | { ok: true; baseUrl: string; label: string }
  | {
      ok: false
      reason:
        | 'invalid-url'
        | 'userinfo'
        | 'unreachable'
        | 'parse'
        | 'timeout'
        | 'interrupted'
    }
  | { ok: false; reason: 'blocked'; host: string }
  | { ok: false; reason: 'http'; status: number }

/** Shared allowlist: WMS endpoints must be http(s), no embedded
 *  credentials (fetch rejects userinfo URLs anyway). Null = rejected. */
export function allowedWmsUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim())
    if (parsed.username || parsed.password) return null
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed
      : null
  } catch {
    return null
  }
}

/** Parseable http(s) URL that only failed allowedWmsUrl on userinfo. */
function hasUserinfo(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim())
    return Boolean(parsed.username || parsed.password)
  } catch {
    return false
  }
}

// Shared stall-aware limits with the viewer path (one knob, same fetch).
export async function probeWmsEndpoint(
  raw: string,
  limits: CapabilitiesLimits = {},
): Promise<WmsProbeResult> {
  const parsed = allowedWmsUrl(raw)
  if (!parsed) {
    return { ok: false, reason: hasUserinfo(raw) ? 'userinfo' : 'invalid-url' }
  }
  const csp = cspConnectPolicy()
  if (csp.restricted && !csp.allows(parsed)) {
    return { ok: false, reason: 'blocked', host: parsed.host }
  }
  const baseUrl = parsed.toString()

  try {
    const capabilities = await fetchCapabilities(baseUrl, undefined, limits)
    // Seed the capabilities cache — activating the source needs no re-download.
    queryClient.setQueryData(wmsCapabilitiesKey(baseUrl), capabilities)
    return { ok: true, baseUrl, label: parsed.host }
  } catch (err) {
    if (err instanceof CapabilitiesError) {
      if (err.kind === 'http') {
        return { ok: false, reason: 'http', status: err.status ?? 0 }
      }
      return { ok: false, reason: err.kind }
    }
    // Network failure or CORS rejection — the browser can't tell them apart.
    return { ok: false, reason: 'unreachable' }
  }
}
