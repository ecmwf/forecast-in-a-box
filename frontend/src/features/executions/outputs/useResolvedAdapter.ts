/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import { GENERIC_ADAPTER, resolveAdapter } from './registry'
import { hasSnifferFor, maxSnifferBytes, runSniffers } from './sniffers'
import type { OutputAdapter, OutputItem } from './types'
import { createLogger } from '@/lib/logger'
import { getJobResult } from '@/api/endpoints/job'

const log = createLogger('useResolvedAdapter')

interface ResolvedAdapter {
  adapter: OutputAdapter
  /** Mime that ultimately drove the dispatch — either `item.mimeType` or
   * a sniffer-promoted value. Useful when the consumer wants to display
   * the actual format (e.g. for the generic-fallback label). */
  effectiveMime: string
}

/**
 * Resolve the adapter for an item, lazily promoting the mime via sniffers
 * when the registered mime is one we know the backend often mislabels
 * (e.g. raw PNG/PDF bytes tagged as `application/pickle`).
 *
 * Sync return path: an exact-match adapter, or GENERIC if no match. If the
 * mime is in any sniffer's candidate list AND we landed on GENERIC, kicks
 * off a one-time blob fetch to read the magic bytes; promotes on match.
 */
export function useResolvedAdapter(item: OutputItem): ResolvedAdapter {
  const initial = resolveAdapter(item.mimeType)
  const [promoted, setPromoted] = useState<string | null>(null)

  useEffect(() => {
    setPromoted(null)
    if (initial !== GENERIC_ADAPTER) return
    if (!item.isAvailable) return
    if (!hasSnifferFor(item.mimeType)) return

    const state: { cancelled: boolean } = { cancelled: false }
    void (async () => {
      try {
        const { blob } = await getJobResult(item.jobId, item.taskId)
        const bytes = Math.max(maxSnifferBytes(), 16)
        const head = new Uint8Array(await blob.slice(0, bytes).arrayBuffer())

        if (state.cancelled) return
        const result = runSniffers(item.mimeType, head)
        if (result) setPromoted(result)
      } catch (err) {
        log.error('Sniffer failed', { taskId: item.taskId, error: err })
      }
    })()
    return () => {
      state.cancelled = true
    }
  }, [initial, item.isAvailable, item.jobId, item.taskId, item.mimeType])

  if (promoted) {
    return { adapter: resolveAdapter(promoted), effectiveMime: promoted }
  }
  return { adapter: initial, effectiveMime: item.mimeType }
}
