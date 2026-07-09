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
 * Cross-source time-link policies. `exact` is scientifically strict
 * (identical instants or hidden); `nearest` tolerates differing rhythms
 * (e.g. hourly ecCharts vs 6-hourly runs) with an explicit per-panel
 * offset tag; `offset` compares deliberately lagged forecasts (B follows
 * A at a fixed Δ); `independent` decouples the axes entirely for manual
 * overlays. Everything stays epoch-keyed; the raw string each server
 * advertised is what goes back out as TIME.
 */

import type { SourceTimeIndex } from './compare-timeline'

export type TimeLinkMode = 'exact' | 'nearest' | 'offset' | 'independent'

export const TIME_LINK_MODES: ReadonlyArray<TimeLinkMode> = [
  'exact',
  'nearest',
  'offset',
  'independent',
]

export interface ResolvedSourceTime {
  /** TIME value to send to THIS server; null → no TIME param. */
  raw: string | null
  /** Epoch actually shown, when resolved. */
  epoch: number | null
  /** Shown − requested, ms (0 for exact hits; null when unresolved). */
  offsetMs: number | null
  /** Source has time steps but none acceptable at the target → hide. */
  hidden: boolean
}

const UNRESOLVED: ResolvedSourceTime = {
  raw: null,
  epoch: null,
  offsetMs: null,
  hidden: false,
}

/**
 * Default nearest-tolerance for a source: half its median step, clamped
 * to [30 min, 12 h] — tight enough to stay honest, loose enough to bridge
 * hourly↔6-hourly rhythms.
 */
export function defaultToleranceMs(index: SourceTimeIndex): number {
  const { epochs } = index
  if (epochs.length < 2) return 3 * 3600_000
  const diffs = epochs
    .slice(1)
    .map((e, i) => e - epochs[i])
    .sort((x, y) => x - y)
  const median = diffs[Math.floor(diffs.length / 2)]
  return Math.min(Math.max(median / 2, 30 * 60_000), 12 * 3600_000)
}

/**
 * Resolve what a source should display for a requested instant.
 * `mode: 'exact'` → identical epoch or hidden. `mode: 'nearest'` → the
 * closest step within `toleranceMs`, or hidden. (`offset` callers shift
 * `targetEpoch` by Δ first and resolve with `nearest`.)
 */
export function resolveSourceTime(
  index: SourceTimeIndex,
  targetEpoch: number | null,
  mode: 'exact' | 'nearest',
  toleranceMs: number,
): ResolvedSourceTime {
  if (index.epochs.length === 0 || targetEpoch === null) return UNRESOLVED

  const exact = index.rawByEpoch.get(targetEpoch)
  if (exact !== undefined) {
    return { raw: exact, epoch: targetEpoch, offsetMs: 0, hidden: false }
  }
  if (mode === 'exact') {
    return { raw: null, epoch: null, offsetMs: null, hidden: true }
  }

  let best: number | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const epoch of index.epochs) {
    const dist = Math.abs(epoch - targetEpoch)
    if (dist < bestDist) {
      bestDist = dist
      best = epoch
    }
  }
  if (best === null || bestDist > toleranceMs) {
    return { raw: null, epoch: null, offsetMs: null, hidden: true }
  }
  return {
    raw: index.rawByEpoch.get(best) ?? null,
    epoch: best,
    offsetMs: best - targetEpoch,
    hidden: false,
  }
}

/** Human tag for a nearest/offset resolution, e.g. "+2 h" / "−30 min". */
export function formatOffset(offsetMs: number): string {
  const sign = offsetMs > 0 ? '+' : '−'
  const abs = Math.abs(offsetMs)
  const hours = Math.floor(abs / 3600_000)
  const minutes = Math.round((abs % 3600_000) / 60_000)
  if (hours === 0) return `${sign}${minutes} min`
  if (minutes === 0) return `${sign}${hours} h`
  return `${sign}${hours} h ${minutes} min`
}

/**
 * Availability as the tracks should DISPLAY it: "would this source render
 * data if the shared slider stood at this instant, under the current
 * time-link policy?" — exact matches only, or nearest-within-tolerance,
 * optionally shifted (offset mode samples B at t + Δ, so its usable
 * window moves against the axis).
 */
export function effectiveAvailability(
  epochs: ReadonlyArray<number>,
  index: SourceTimeIndex,
  mode: 'exact' | 'nearest',
  shiftMs: number,
  toleranceMs: number,
): Array<boolean> {
  if (index.epochs.length === 0) return epochs.map(() => false)
  return epochs.map((epoch) => {
    const target = epoch + shiftMs
    if (mode === 'exact') return index.rawByEpoch.has(target)
    return !resolveSourceTime(index, target, 'nearest', toleranceMs).hidden
  })
}
