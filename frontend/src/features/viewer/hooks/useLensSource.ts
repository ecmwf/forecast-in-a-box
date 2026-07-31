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
 * Per-source WMS capabilities via TanStack Query, keyed by origin — big
 * external catalogs (multi-MB, 20+ s) download once and are shared by
 * probe, viewer, and remounts. The retry ladder hides the lens
 * `running`-before-port-ready race.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  appendWmsParams,
  groupLayers,
  isLoopbackUrl,
  parseCapabilities,
  toWmsEndpoint,
} from '../wms-capabilities'
import type { LayerGroup, ParsedLayer } from '../wms-capabilities'

// GetCapabilities retry — lens `running` precedes WMS-port readiness.
// Loopback = our own lens: a cold SkinnyWMS boot can take tens of
// seconds, so keep trying (~35 s) instead of parking on an error the
// next attempt would clear. External servers keep the snappy ladder.
const EXTERNAL_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800] as const
const LOOPBACK_RETRY_DELAYS_MS = [
  300, 600, 1200, 2400, 4800, 5000, 5000, 5000, 5000, 5000,
] as const

/** Cache identity for one server's parsed capabilities. */
export function wmsCapabilitiesKey(baseUrl: string): ReadonlyArray<string> {
  return ['wms-capabilities', baseUrl]
}

export type ParsedCapabilities = ReturnType<typeof parseCapabilities>

const NO_LAYERS: ReadonlyArray<ParsedLayer> = []

export interface LensSource {
  layers: ReadonlyArray<ParsedLayer>
  decorationLayers: ReadonlyArray<ParsedLayer>
  /** EPSG:4326 [west, south, east, north] advertised by the server. */
  bbox: [number, number, number, number] | null
  error: string | null
  loadingLayers: boolean
  /** True between failed attempts while the retry ladder is running. */
  retrying: boolean
  groups: Array<LayerGroup>
  retry: () => void
}

/** `baseUrl: null` yields an inert source: no fetch, empty layers. */
export function useLensSource(baseUrl: string | null): LensSource {
  const retryDelays =
    baseUrl !== null && isLoopbackUrl(baseUrl)
      ? LOOPBACK_RETRY_DELAYS_MS
      : EXTERNAL_RETRY_DELAYS_MS
  const query = useQuery({
    queryKey: wmsCapabilitiesKey(baseUrl ?? ''),
    enabled: baseUrl !== null,
    queryFn: async ({ signal }): Promise<ParsedCapabilities> => {
      const res = await fetch(
        appendWmsParams(
          toWmsEndpoint(baseUrl!),
          'service=WMS&version=1.3.0&request=GetCapabilities',
        ),
        { signal },
      )
      if (!res.ok) throw new Error(`GetCapabilities ${res.status}`)
      return parseCapabilities(await res.text())
    },
    retry: (failureCount) => failureCount <= retryDelays.length,
    retryDelay: (failureCount) =>
      retryDelays[Math.min(failureCount, retryDelays.length) - 1],
    // Stale-while-revalidate: cached instantly, silently refreshed every
    // 5 min while viewed — new model runs extend the time axis.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })

  const layers = query.data?.layers ?? NO_LAYERS
  const groups = useMemo<Array<LayerGroup>>(() => groupLayers(layers), [layers])

  return {
    layers,
    decorationLayers: query.data?.decorationLayers ?? NO_LAYERS,
    bbox: query.data?.bbox ?? null,
    error: query.error ? query.error.message : null,
    loadingLayers: baseUrl !== null && query.isPending,
    retrying: query.isFetching && query.failureCount > 0,
    groups,
    retry: () => void query.refetch(),
  }
}
