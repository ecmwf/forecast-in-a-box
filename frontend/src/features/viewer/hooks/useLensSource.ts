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
  CapabilitiesError,
  fetchCapabilities,
  groupLayers,
  isLensProxyUrl,
} from '../wms-capabilities'
import type {
  LayerGroup,
  ParsedCapabilities,
  ParsedLayer,
} from '../wms-capabilities'

// GetCapabilities retry — lens `running` precedes WMS-port readiness.
// Our lens proxy: a cold SkinnyWMS boot can take tens of seconds, so keep
// trying (~35 s) instead of parking on an error the next attempt would
// clear. External servers keep the snappy ladder.
const EXTERNAL_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800] as const
const LENS_RETRY_DELAYS_MS = [
  300, 600, 1200, 2400, 4800, 5000, 5000, 5000, 5000, 5000,
] as const
/** Lens proxy: 400 unproxyable, 404 gone, 500 dead — 503 (starting) retries. */
const LENS_PROXY_FINAL_STATUSES = new Set([400, 404, 500])

/** Cache identity for one server's parsed capabilities. */
export function wmsCapabilitiesKey(baseUrl: string): ReadonlyArray<string> {
  return ['wms-capabilities', baseUrl]
}

const NO_LAYERS: ReadonlyArray<ParsedLayer> = []
const NO_CRS: ReadonlyArray<string> = []

export interface LensSource {
  layers: ReadonlyArray<ParsedLayer>
  /** HTTP status behind `error`, when the failure was an HTTP answer. */
  errorStatus: number | null
  decorationLayers: ReadonlyArray<ParsedLayer>
  /** EPSG:4326 [west, south, east, north] advertised by the server. */
  bbox: [number, number, number, number] | null
  /** Advertised CRS codes (empty until loaded — see `supportsCrs`). */
  crs: ReadonlyArray<string>
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
    baseUrl !== null && isLensProxyUrl(baseUrl)
      ? LENS_RETRY_DELAYS_MS
      : EXTERNAL_RETRY_DELAYS_MS
  const query = useQuery({
    queryKey: wmsCapabilitiesKey(baseUrl ?? ''),
    enabled: baseUrl !== null,
    queryFn: ({ signal }): Promise<ParsedCapabilities> =>
      fetchCapabilities(baseUrl!, signal),
    // Timeout/interruption burned a long attempt; final proxy answers won't change.
    retry: (failureCount, error) =>
      !(
        error instanceof CapabilitiesError &&
        (error.kind === 'timeout' ||
          error.kind === 'interrupted' ||
          (isLensProxyUrl(baseUrl ?? '') &&
            error.status !== undefined &&
            LENS_PROXY_FINAL_STATUSES.has(error.status)))
      ) && failureCount <= retryDelays.length,
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
    crs: query.data?.crs ?? NO_CRS,
    error: query.error ? query.error.message : null,
    errorStatus:
      query.error instanceof CapabilitiesError
        ? (query.error.status ?? null)
        : null,
    loadingLayers: baseUrl !== null && query.isPending,
    retrying: query.isFetching && query.failureCount > 0,
    groups,
    retry: () => void query.refetch(),
  }
}
