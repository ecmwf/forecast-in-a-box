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
 * Valid-time state for the compare viewer: the epoch-keyed union axis,
 * step/clip selection, the time-link policy (exact / nearest / offset /
 * independent), per-side resolution, and the failure-mark projection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatStep } from '../format'
import {
  buildCompareTimeline,
  buildSourceTimeIndex,
  locateEpoch,
} from './compare-timeline'
import {
  defaultToleranceMs,
  effectiveAvailability,
  effectiveFailureLayers,
  formatOffset,
  medianStepMs,
  offsetBounds,
  resolveSourceTime,
} from './time-link'
import type { LensSource } from '../hooks/useLensSource'
import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'
import type { TimeLinkMode } from './time-link'
import type { ViewerUrlState } from './view-url-state'

export function useViewerTimeline({
  sourceA,
  sourceB,
  activeOrderA,
  activeOrderB,
  initial,
  failedLayers,
}: {
  sourceA: LensSource
  sourceB: LensSource
  activeOrderA: ReadonlyArray<string>
  activeOrderB: ReadonlyArray<string>
  /** URL-restored seeds (`t`/`tl`/`dt`), read once at mount. */
  initial: Pick<ViewerUrlState, 'timeMs' | 'timeLink' | 'offsetMs'> | null
  /** GetMap failure marks (epoch → layer names) per slot. */
  failedLayers: Record<SourceSlot, ReadonlyMap<number, ReadonlyArray<string>>>
}) {
  const timeIndexA = useMemo(
    () => buildSourceTimeIndex(sourceA.layers, activeOrderA),
    [sourceA.layers, activeOrderA],
  )
  const timeIndexB = useMemo(
    () => buildSourceTimeIndex(sourceB.layers, activeOrderB),
    [sourceB.layers, activeOrderB],
  )
  const timeline = useMemo(
    () => buildCompareTimeline(timeIndexA, timeIndexB),
    [timeIndexA, timeIndexB],
  )
  // Raw per-source step strings, epoch-ordered (prefetch warmup).
  const rawStepsA = useMemo(
    () =>
      timeIndexA.epochs.flatMap((e) => {
        const raw = timeIndexA.rawByEpoch.get(e)
        return raw !== undefined ? [raw] : []
      }),
    [timeIndexA],
  )
  const rawStepsB = useMemo(
    () =>
      timeIndexB.epochs.flatMap((e) => {
        const raw = timeIndexB.rawByEpoch.get(e)
        return raw !== undefined ? [raw] : []
      }),
    [timeIndexB],
  )
  const [timeStep, setTimeStep] = useState(0)
  // Focus window over the union axis (indices into timeline.epochs).
  const [timeClip, setTimeClip] = useState<[number, number] | null>(null)
  // Re-locate the selected instant when the union changes (layer add/
  // remove) instead of snapping to 0 — URL-seeded, so it also restores `t`.
  const lastEpochRef = useRef<number | null>(initial?.timeMs ?? null)
  useEffect(() => {
    const located = locateEpoch(timeline.epochs, lastEpochRef.current)
    // Functional update: `timeStep` stays out of the deps on purpose —
    // this must run only when the union changes, not on every scrub.
    if (located >= 0) setTimeStep((step) => (step === located ? step : located))
  }, [timeline.epochs])
  const onTimeChange = useCallback(
    (index: number) => {
      setTimeStep(index)
      lastEpochRef.current =
        index >= 0 && index < timeline.epochs.length
          ? timeline.epochs[index]
          : null
    },
    [timeline.epochs],
  )

  // Drop a stale clip when the union changes shape under it.
  useEffect(() => {
    if (timeClip && timeClip[1] > timeline.epochs.length - 1) setTimeClip(null)
  }, [timeClip, timeline.epochs.length])

  const clipStart = timeClip ? timeClip[0] : 0
  const clipEnd = timeClip ? timeClip[1] : timeline.epochs.length - 1
  const safeStep = Math.max(
    Math.max(0, clipStart),
    Math.min(timeStep, Math.min(timeline.epochs.length - 1, clipEnd)),
  )
  const currentEpoch: number | null =
    timeline.epochs.length > 0 ? timeline.epochs[safeStep] : null

  // -------- Time-link policy (exact / nearest / offset / independent) --
  const [timeLinkMode, setTimeLinkMode] = useState<TimeLinkMode>(
    () => initial?.timeLink ?? 'exact',
  )
  const [offsetMs, setOffsetMs] = useState(() => initial?.offsetMs ?? 0)
  // From the RAW indexes — displayTimeline already shifts B by Δ, so
  // deriving bounds from it would feed back on itself.
  const offsetMeta = useMemo(() => {
    const [minMs, maxMs] = offsetBounds(timeIndexA, timeIndexB)
    const epochsA = timeIndexA.epochs
    const epochsB = timeIndexB.epochs
    const empty = epochsA.length === 0 || epochsB.length === 0
    return {
      minMs,
      maxMs,
      stepMs: Math.min(medianStepMs(timeIndexA), medianStepMs(timeIndexB)),
      alignStartsMs: empty ? null : epochsB[0] - epochsA[0],
      alignEndsMs: empty
        ? null
        : epochsB[epochsB.length - 1] - epochsA[epochsA.length - 1],
    }
  }, [timeIndexA, timeIndexB])
  const [indepIndex, setIndepIndex] = useState<Record<SourceSlot, number>>({
    a: 0,
    b: 0,
  })

  const resolvedA = useMemo(() => {
    if (timeLinkMode === 'independent') {
      const i = Math.max(
        0,
        Math.min(indepIndex.a, timeIndexA.epochs.length - 1),
      )
      const epoch = timeIndexA.epochs.length > 0 ? timeIndexA.epochs[i] : null
      return {
        raw: epoch !== null ? (timeIndexA.rawByEpoch.get(epoch) ?? null) : null,
        epoch,
        offsetMs: null,
        hidden: false,
      }
    }
    return resolveSourceTime(
      timeIndexA,
      currentEpoch,
      timeLinkMode === 'exact' ? 'exact' : 'nearest',
      defaultToleranceMs(timeIndexA),
    )
  }, [timeLinkMode, indepIndex.a, timeIndexA, currentEpoch])
  const resolvedB = useMemo(() => {
    if (timeLinkMode === 'independent') {
      const i = Math.max(
        0,
        Math.min(indepIndex.b, timeIndexB.epochs.length - 1),
      )
      const epoch = timeIndexB.epochs.length > 0 ? timeIndexB.epochs[i] : null
      return {
        raw: epoch !== null ? (timeIndexB.rawByEpoch.get(epoch) ?? null) : null,
        epoch,
        offsetMs: null,
        hidden: false,
      }
    }
    const target =
      timeLinkMode === 'offset' && currentEpoch !== null
        ? currentEpoch + offsetMs
        : currentEpoch
    return resolveSourceTime(
      timeIndexB,
      target,
      timeLinkMode === 'exact' ? 'exact' : 'nearest',
      defaultToleranceMs(timeIndexB),
    )
  }, [timeLinkMode, indepIndex.b, timeIndexB, currentEpoch, offsetMs])

  const resolvedFor = (slot: SourceSlot) =>
    slot === 'a' ? resolvedA : resolvedB

  // Per-side hover instants for the timeline tooltip: what each side
  // would display if the slider stood at the hovered epoch.
  const hoverTimes = useCallback(
    (epoch: number) => {
      if (timeLinkMode === 'exact' || timeLinkMode === 'independent') {
        return null
      }
      const ra = resolveSourceTime(
        timeIndexA,
        epoch,
        'nearest',
        defaultToleranceMs(timeIndexA),
      )
      const rb = resolveSourceTime(
        timeIndexB,
        timeLinkMode === 'offset' ? epoch + offsetMs : epoch,
        'nearest',
        defaultToleranceMs(timeIndexB),
      )
      const label = (e: number | null) =>
        e !== null ? formatStep(new Date(e).toISOString()) : null
      return { a: label(ra.epoch), b: label(rb.epoch) }
    },
    [timeLinkMode, timeIndexA, timeIndexB, offsetMs],
  )

  // Tracks (and the A/B/A∩B window presets) show what each side WOULD
  // render at every axis position under the current time-link policy —
  // under a +48h offset, B's usable window visibly shifts off the tail.
  const displayTimeline = useMemo(() => {
    if (timeLinkMode === 'exact' || timeLinkMode === 'independent') {
      return timeline
    }
    return {
      ...timeline,
      availability: {
        a: effectiveAvailability(
          timeline.epochs,
          timeIndexA,
          'nearest',
          0,
          defaultToleranceMs(timeIndexA),
        ),
        b: effectiveAvailability(
          timeline.epochs,
          timeIndexB,
          'nearest',
          timeLinkMode === 'offset' ? offsetMs : 0,
          defaultToleranceMs(timeIndexB),
        ),
      },
    }
  }, [timeline, timeIndexA, timeIndexB, timeLinkMode, offsetMs])

  // Stable per-slot identities: these feed effect deps in the layer
  // stacks, where a fresh closure per render would reconcile every render.
  const resolveTimeA = useMemo(
    () =>
      (layer: ParsedLayer): string | null =>
        layer.time ? resolvedA.raw : null,
    [resolvedA],
  )
  const resolveTimeB = useMemo(
    () =>
      (layer: ParsedLayer): string | null =>
        layer.time ? resolvedB.raw : null,
    [resolvedB],
  )

  // Marks projected onto the shared axis exactly like availability, so a
  // mark paints where the failing instant is actually displayed. Names
  // resolve to display titles here — the slider shows words, not ids.
  const trackFailures = useMemo(() => {
    const resolveMode =
      timeLinkMode === 'nearest' || timeLinkMode === 'offset'
        ? ('nearest' as const)
        : ('exact' as const)
    const titled = (
      cells: Array<ReadonlyArray<string>>,
      layers: ReadonlyArray<ParsedLayer>,
    ) =>
      cells.map((names) =>
        names.map((n) => layers.find((l) => l.name === n)?.title ?? n),
      )
    return {
      a: titled(
        effectiveFailureLayers(
          timeline.epochs,
          timeIndexA,
          failedLayers.a,
          resolveMode,
          0,
          defaultToleranceMs(timeIndexA),
        ),
        sourceA.layers,
      ),
      b: titled(
        effectiveFailureLayers(
          timeline.epochs,
          timeIndexB,
          failedLayers.b,
          resolveMode,
          timeLinkMode === 'offset' ? offsetMs : 0,
          defaultToleranceMs(timeIndexB),
        ),
        sourceB.layers,
      ),
    }
  }, [
    timeline.epochs,
    timeIndexA,
    timeIndexB,
    failedLayers,
    timeLinkMode,
    offsetMs,
    sourceA.layers,
    sourceB.layers,
  ])

  // Offset tag relative to the SHARED axis (A's requested instant), so a
  // fixed-Δ B honestly reads e.g. "B +6 h".
  const timeTagFor = (slot: SourceSlot): string | null => {
    if (timeLinkMode === 'independent') return null
    const resolved = resolvedFor(slot)
    if (resolved.epoch === null || currentEpoch === null) return null
    const delta = resolved.epoch - currentEpoch
    return delta === 0 ? null : formatOffset(delta)
  }

  return {
    timeIndexA,
    timeIndexB,
    timeline,
    displayTimeline,
    rawStepsA,
    rawStepsB,
    safeStep,
    currentEpoch,
    onTimeChange,
    timeClip,
    setTimeClip,
    timeLinkMode,
    setTimeLinkMode,
    offsetMs,
    setOffsetMs,
    offsetMeta,
    indepIndex,
    setIndepIndex,
    resolvedA,
    resolvedB,
    resolvedFor,
    resolveTimeA,
    resolveTimeB,
    hoverTimes,
    trackFailures,
    timeTagFor,
  }
}
