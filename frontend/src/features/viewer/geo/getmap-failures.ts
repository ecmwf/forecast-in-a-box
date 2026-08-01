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
 * Negative cache of GetMap failures ("advertised but not served").
 * Marks are evidence, never prediction: set only by an actually-failed
 * request, and kept fresh three ways — a success at the same instant
 * clears them, a TTL expires them, and the owner drops a slot's marks
 * whenever its capabilities change (new model run).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseWmsTimestamp } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'

/** Matches the capabilities background-refresh cadence (useLensSource). */
const FAILURE_TTL_MS = 5 * 60_000
const PRUNE_INTERVAL_MS = 30_000

export interface GetMapFailureLog {
  /** Epochs with at least one currently-failing layer, per slot. */
  failedEpochs: Record<SourceSlot, ReadonlySet<number>>
  /** Failing layer NAMES per epoch, per slot — feeds attribution UI. */
  failedLayers: Record<SourceSlot, ReadonlyMap<number, ReadonlyArray<string>>>
  /** Record a load outcome; `time` is the raw WMS TIME that was sent. */
  report: (
    slot: SourceSlot,
    layerName: string,
    time: string | null,
    ok: boolean,
  ) => void
  /** Drop a slot's marks (source or capabilities changed). */
  clearSlot: (slot: SourceSlot) => void
  /** Drop marks from layers outside the active set — a deactivated
   *  layer can never clear its marks by succeeding again. */
  retainLayers: (slot: SourceSlot, layerNames: ReadonlyArray<string>) => void
}

export function useGetMapFailureLog({
  ttlMs = FAILURE_TTL_MS,
  pruneIntervalMs = PRUNE_INTERVAL_MS,
}: { ttlMs?: number; pruneIntervalMs?: number } = {}): GetMapFailureLog {
  // `${slot}|${epoch}|${layer}` → failure timestamp. Per-layer keys keep
  // precision when layers of one source disagree about an instant: the
  // epoch stays marked until every failing layer has recovered.
  const [marks, setMarks] = useState<ReadonlyMap<string, number>>(new Map())

  const report = useCallback(
    (slot: SourceSlot, layerName: string, time: string | null, ok: boolean) => {
      if (time === null) return
      // Same reading as buildSourceTimeIndex, or marks miss their epochs.
      const epoch = parseWmsTimestamp(time)
      if (!Number.isFinite(epoch)) return
      const key = `${slot}|${epoch}|${layerName}`
      setMarks((prev) => {
        if (ok) {
          if (!prev.has(key)) return prev
          const next = new Map(prev)
          next.delete(key)
          return next
        }
        // Keep the first-failure timestamp: re-marking on every retry
        // would churn state (and re-render loops feed on that); the TTL
        // then doubles as the re-probe cadence for persistent failures.
        if (prev.has(key)) return prev
        const next = new Map(prev)
        next.set(key, Date.now())
        return next
      })
    },
    [],
  )

  const clearSlot = useCallback((slot: SourceSlot) => {
    setMarks((prev) => {
      const next = new Map(
        [...prev].filter(([key]) => !key.startsWith(`${slot}|`)),
      )
      return next.size === prev.size ? prev : next
    })
  }, [])

  const retainLayers = useCallback(
    (slot: SourceSlot, layerNames: ReadonlyArray<string>) => {
      const keep = new Set(layerNames)
      setMarks((prev) => {
        const next = new Map(
          [...prev].filter(([key]) => {
            const parts = key.split('|')
            // Layer names may contain '|' — everything past slot|epoch.
            return parts[0] !== slot || keep.has(parts.slice(2).join('|'))
          }),
        )
        return next.size === prev.size ? prev : next
      })
    },
    [],
  )

  // TTL prune — a mark may overstay by at most one interval; revisiting a
  // marked instant re-probes anyway (the layer stack retries on params).
  useEffect(() => {
    const id = window.setInterval(() => {
      setMarks((prev) => {
        const cutoff = Date.now() - ttlMs
        const next = new Map([...prev].filter(([, at]) => at > cutoff))
        return next.size === prev.size ? prev : next
      })
    }, pruneIntervalMs)
    return () => window.clearInterval(id)
  }, [ttlMs, pruneIntervalMs])

  const failedLayers = useMemo(() => {
    const out: Record<SourceSlot, Map<number, Array<string>>> = {
      a: new Map(),
      b: new Map(),
    }
    for (const key of marks.keys()) {
      const parts = key.split('|')
      const epoch = Number(parts[1])
      // Layer names may contain '|' — everything past slot|epoch.
      const layer = parts.slice(2).join('|')
      const perEpoch = out[parts[0] as SourceSlot]
      const list = perEpoch.get(epoch)
      if (list) list.push(layer)
      else perEpoch.set(epoch, [layer])
    }
    return out
  }, [marks])

  const failedEpochs = useMemo(
    () => ({
      a: new Set(failedLayers.a.keys()),
      b: new Set(failedLayers.b.keys()),
    }),
    [failedLayers],
  )

  return { failedEpochs, failedLayers, report, clearSlot, retainLayers }
}
