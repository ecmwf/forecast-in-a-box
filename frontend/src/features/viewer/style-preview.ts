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
 * Live style previews: one small GetMap per style over the current view,
 * cached by URL. Shaped by `layerRequestParams` — previews match the map.
 */

import { useEffect } from 'react'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { getHeight, getWidth } from 'ol/extent'
import { getRequestUrl } from 'ol/source/wms'
import { requestProjection } from './projections'
import { layerRequestParams, toWmsEndpoint } from './wms-capabilities'
import type { Extent } from 'ol/extent'
import type View from 'ol/View'
import type { QueryClient } from '@tanstack/react-query'
import type { BboxAxisOrder } from './projections'
import type { LayerRequestSettings, ParsedLayer } from './wms-capabilities'

/** The view snapshot a preview batch renders against. */
export interface PreviewFrame {
  extent: Extent
  size: [number, number]
}

const PREVIEW_WIDTH = 240
const PREVIEW_MAX_HEIGHT = 200

/** Current viewport as a thumbnail frame; extent quantised for caching. */
export function previewFrame(view: View): PreviewFrame | null {
  const extent = view.calculateExtent()
  const width = getWidth(extent)
  const height = getHeight(extent)
  if (!(width > 0) || !(height > 0) || !extent.every(Number.isFinite)) {
    return null
  }
  let w = PREVIEW_WIDTH
  let h = Math.round((w * height) / width)
  if (h > PREVIEW_MAX_HEIGHT) {
    h = PREVIEW_MAX_HEIGHT
    w = Math.round((h * width) / height)
  }
  // ~0.5 % steps: small pans reuse cached thumbnails.
  const q = width / 200
  return {
    extent: extent.map((v) => Math.round(v / q) * q),
    size: [w, h],
  }
}

export interface PreviewTarget {
  baseUrl: string
  layer: ParsedLayer
  settings: LayerRequestSettings | undefined
  time: string | null
  bboxAxisOrder: BboxAxisOrder
}

/** GetMap URL for one style thumbnail (same axis handling as the map). */
export function stylePreviewUrl(
  target: PreviewTarget,
  view: View,
  frame: PreviewFrame,
): string {
  const projection =
    requestProjection(view, target.bboxAxisOrder) ?? view.getProjection()
  const params = {
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    ...layerRequestParams(target.layer, target.settings, target.time),
  }
  return getRequestUrl(
    toWmsEndpoint(target.baseUrl),
    frame.extent,
    frame.size,
    projection,
    params,
  )
}

const PREVIEW_KEY = 'wms-style-preview'

function previewQuery(url: string) {
  return queryOptions({
    queryKey: [PREVIEW_KEY, url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`GetMap ${res.status}`)
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) throw new Error('not an image')
      return URL.createObjectURL(blob)
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  })
}

// Object URLs die with their cache entry — one revoke hook per client.
const revokeHooked = new WeakSet<QueryClient>()
function hookRevoke(client: QueryClient): void {
  if (revokeHooked.has(client)) return
  revokeHooked.add(client)
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return
    const { queryKey, state } = event.query
    if (queryKey[0] === PREVIEW_KEY && typeof state.data === 'string') {
      URL.revokeObjectURL(state.data)
    }
  })
}

/** Thumbnail for `url` (null disables); `src` is an object URL. */
export function useStylePreview(url: string | null): {
  src: string | null
  loading: boolean
  failed: boolean
} {
  const client = useQueryClient()
  hookRevoke(client)
  const query = useQuery({
    ...previewQuery(url ?? ''),
    enabled: url !== null,
  })
  return {
    src: url !== null && query.data ? query.data : null,
    loading: url !== null && query.isPending,
    failed: url !== null && query.isError,
  }
}

/** Warm every URL, `concurrency` at a time, while `enabled`. */
export function usePrefetchStylePreviews(
  urls: ReadonlyArray<string>,
  enabled: boolean,
  concurrency: number,
): void {
  const client = useQueryClient()
  useEffect(() => {
    if (!enabled || urls.length === 0) return
    hookRevoke(client)
    let cancelled = false
    const queue = [...urls]
    const worker = async () => {
      for (let url = queue.shift(); url && !cancelled; url = queue.shift()) {
        await client.prefetchQuery(previewQuery(url))
      }
    }
    void Promise.all(Array.from({ length: concurrency }, worker))
    return () => {
      cancelled = true
    }
  }, [client, urls, enabled, concurrency])
}
