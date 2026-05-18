/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GENERIC_ADAPTER, resolveAdapter } from './registry'
import { hasSnifferFor, maxSnifferBytes, runSniffers } from './sniffers'
import { fetchJobResultHead } from './useJobResult'
import type { OutputItem } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('useResolvedMimes')

/** An output whose real mime is only knowable by sniffing: it's available,
 * and tagged with an opaque wire mime that no adapter claims but some sniffer
 * might promote (cascade tags raw bytes `application/octet-stream` etc.). */
export function needsSniff(item: OutputItem): boolean {
  return (
    item.isAvailable &&
    resolveAdapter(item.mimeType) === GENERIC_ADAPTER &&
    hasSnifferFor(item.mimeType)
  )
}

/**
 * Resolve the real mime of every sniffable output up front, across the whole
 * list and independent of any filter.
 *
 * Sniffing must not live in the card: the Outputs grid filters by effective
 * mime, so a card whose wire mime doesn't match a `?mimes=` filter never
 * renders — never sniffs — never learns the mime that *would* match. A filter
 * restored from the URL on a fresh load would deadlock every sniff-promoted
 * item out of view. Resolving here, over the unfiltered list, breaks that
 * cycle.
 *
 * Returns a taskId → effective-mime map; an entry is written once a sniff
 * settles (the promoted mime, or the wire mime when nothing matched).
 */
export function useResolvedMimes(
  items: ReadonlyArray<OutputItem>,
): Record<string, string> {
  const queryClient = useQueryClient()
  const [resolvedMimes, setResolvedMimes] = useState<Record<string, string>>({})
  // taskIds already sniffed — survives the `items` identity churn of a
  // polling running-job query so each output is fetched exactly once.
  const sniffed = useRef<Set<string>>(new Set())

  useEffect(() => {
    const targets = items.filter(
      (item) => needsSniff(item) && !sniffed.current.has(item.taskId),
    )
    if (targets.length === 0) return

    for (const item of targets) sniffed.current.add(item.taskId)
    const headBytes = Math.max(maxSnifferBytes(), 16)

    for (const item of targets) {
      void (async () => {
        let effective = item.mimeType
        try {
          // Range-bounded fetch: only the leading magic bytes, never the
          // whole (potentially multi-gigabyte) payload.
          const head = await fetchJobResultHead(
            queryClient,
            item.jobId,
            item.taskId,
            headBytes,
          )
          effective = runSniffers(item.mimeType, head) ?? item.mimeType
        } catch (err) {
          log.error('Sniffer failed', { taskId: item.taskId, error: err })
        } finally {
          setResolvedMimes((prev) => ({ ...prev, [item.taskId]: effective }))
        }
      })()
    }
  }, [items, queryClient])

  return resolvedMimes
}
