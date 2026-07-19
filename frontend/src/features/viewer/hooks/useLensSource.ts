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
 * Per-source WMS capabilities state: fetch (with a retry ladder hiding the
 * lens `running`-before-port-ready race), parse, and derive the grouped
 * layer view-models. One instance per WMS origin — the compare viewer
 * mounts one per panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appendWmsParams,
  groupLayers,
  parseCapabilities,
  partitionGroups,
  toWmsEndpoint,
  uniquePressureLevels,
} from '../wms-capabilities'
import type {
  LayerGroup,
  ParsedLayer,
  PartitionedGroups,
} from '../wms-capabilities'
import { createLogger } from '@/lib/logger'

const log = createLogger('useLensSource')

// GetCapabilities retry — lens `running` precedes WMS-port readiness.
const CAPABILITIES_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800] as const

export interface LensSource {
  layers: Array<ParsedLayer>
  decorationLayers: Array<ParsedLayer>
  /** EPSG:4326 [west, south, east, north] advertised by the server. */
  bbox: [number, number, number, number] | null
  error: string | null
  loadingLayers: boolean
  /** True between failed attempts while the retry ladder is running. */
  retrying: boolean
  groups: Array<LayerGroup>
  partitioned: PartitionedGroups
  allLevels: Array<number>
  retry: () => void
}

/** `baseUrl: null` yields an inert source: no fetch, empty layers. */
export function useLensSource(baseUrl: string | null): LensSource {
  const [layers, setLayers] = useState<Array<ParsedLayer>>([])
  const [decorationLayers, setDecorationLayers] = useState<Array<ParsedLayer>>(
    [],
  )
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loadingLayers, setLoadingLayers] = useState(baseUrl !== null)

  // `retryNonce` re-triggers the fetch effect on manual retry.
  const [retryNonce, setRetryNonce] = useState(0)
  const [retrying, setRetrying] = useState(false)

  // Sync `loadingLayers` with baseUrl changes during render — the fetch
  // effect flips it too late for same-commit consumers (the compare
  // auto-unlink would see a stale not-loading source the instant B is
  // added or swapped and wrongly drop the linked selection).
  const [prevBaseUrl, setPrevBaseUrl] = useState<string | null>(baseUrl)
  if (baseUrl !== prevBaseUrl) {
    setPrevBaseUrl(baseUrl)
    setLoadingLayers(baseUrl !== null)
  }

  useEffect(() => {
    if (baseUrl === null) {
      setLayers([])
      setDecorationLayers([])
      setBbox(null)
      setError(null)
      setLoadingLayers(false)
      setRetrying(false)
      return
    }
    const ac = new AbortController()
    const delaysMs = CAPABILITIES_RETRY_DELAYS_MS
    setError(null)
    setLoadingLayers(true)
    setRetrying(false)
    void (async () => {
      let lastErr: unknown
      for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        if (ac.signal.aborted) return
        try {
          const res = await fetch(
            appendWmsParams(
              toWmsEndpoint(baseUrl),
              'service=WMS&version=1.3.0&request=GetCapabilities',
            ),
            { signal: ac.signal },
          )
          if (!res.ok) throw new Error(`GetCapabilities ${res.status}`)
          const xml = await res.text()
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aborted by cleanup
          if (ac.signal.aborted) return
          const parsed = parseCapabilities(xml)
          setLayers(parsed.layers)
          setDecorationLayers(parsed.decorationLayers)
          setBbox(parsed.bbox)
          setLoadingLayers(false)
          setRetrying(false)
          return
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aborted by cleanup
          if (ac.signal.aborted) return
          lastErr = err
          if (attempt === delaysMs.length) break
          setRetrying(true)
          await new Promise((r) => setTimeout(r, delaysMs[attempt]))
        }
      }
      if (ac.signal.aborted) return
      log.error('Failed to fetch WMS capabilities', { error: lastErr })
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr))
      setLoadingLayers(false)
      setRetrying(false)
    })()
    return () => ac.abort()
  }, [baseUrl, retryNonce])

  const retry = useCallback(() => setRetryNonce((n) => n + 1), [])

  // Group + level view-models, recomputed when capabilities change.
  const groups = useMemo<Array<LayerGroup>>(() => groupLayers(layers), [layers])
  const partitioned = useMemo(() => partitionGroups(groups), [groups])
  const allLevels = useMemo(() => uniquePressureLevels(groups), [groups])

  return {
    layers,
    decorationLayers,
    bbox,
    error,
    loadingLayers,
    retrying,
    groups,
    partitioned,
    allLevels,
    retry,
  }
}
