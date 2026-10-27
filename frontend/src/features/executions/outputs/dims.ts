/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Split coordinates of run outputs: ordering, stepping and filtering. */

import type { OutputItem } from './types'

/** One split coordinate as sent by the backend, e.g. ["step", "6"]. */
export type OutputDim = readonly [key: string, value: string]

/** Selected values per dimension; an absent key is unfiltered, [] keeps none. */
export type DimFilter = Readonly<Record<string, ReadonlyArray<string>>>

/** Key prefix of block settings. */
export const SETTING_PREFIX = 'setting:'

/** Dimensions ordered innermost. */
const TIME_DIMS: ReadonlySet<string> = new Set([
  'step',
  'date',
  'time',
  'valid_datetime',
])

const collator = new Intl.Collator(undefined, { numeric: true })

/** Numeric order when both values are numbers, else natural string order. */
export function compareDimValues(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na - nb
  }
  return collator.compare(a, b)
}

/** Outer to inner: wire order with time dimensions moved last. */
export function orderDims(dims: ReadonlyArray<OutputDim>): Array<OutputDim> {
  return [
    ...dims.filter(([key]) => !TIME_DIMS.has(key)),
    ...dims.filter(([key]) => TIME_DIMS.has(key)),
  ]
}

/** Block name plus subtitle. */
export function outputTitle(item: OutputItem): string {
  return item.subtitle ? `${item.blockName} · ${item.subtitle}` : item.blockName
}

export function dimValue(item: OutputItem, key: string): string | undefined {
  const pairs = key.startsWith(SETTING_PREFIX) ? item.settings : item.dims
  return pairs?.find(([k]) => k === key)?.[1]
}

/** Compares the coordinates both items share, outer to inner. */
export function compareDims(a: OutputItem, b: OutputItem): number {
  for (const [key, value] of orderDims(a.dims ?? [])) {
    const other = dimValue(b, key)
    if (other === undefined) continue
    const cmp = compareDimValues(value, other)
    if (cmp !== 0) return cmp
  }
  return 0
}

/** Distinct values per setting then dimension, with counts. */
export function dimValueCounts(
  items: ReadonlyArray<OutputItem>,
): Map<string, Array<[value: string, count: number]>> {
  const counts = new Map<string, Map<string, number>>()
  for (const item of items) {
    for (const [key, value] of [
      ...(item.settings ?? []),
      ...orderDims(item.dims ?? []),
    ]) {
      const byValue = counts.get(key) ?? new Map<string, number>()
      byValue.set(value, (byValue.get(value) ?? 0) + 1)
      counts.set(key, byValue)
    }
  }
  return new Map(
    [...counts].map(([key, byValue]) => [
      key,
      [...byValue].sort(([a], [b]) => compareDimValues(a, b)),
    ]),
  )
}

/** Items sharing every coordinate but `key` with `current`, ordered by it. */
export function dimLine(
  items: ReadonlyArray<OutputItem>,
  current: OutputItem,
  key: string,
): Array<[value: string, item: OutputItem]> {
  if (dimValue(current, key) === undefined) return []
  const fixed = (current.dims ?? []).filter(([k]) => k !== key)
  const line: Array<[string, OutputItem]> = []
  for (const item of items) {
    if (item.originalBlock !== current.originalBlock) continue
    const value = dimValue(item, key)
    if (value === undefined) continue
    if (fixed.every(([k, v]) => dimValue(item, k) === v)) {
      line.push([value, item])
    }
  }
  return line.sort(([a], [b]) => compareDimValues(a, b))
}

/** The item one value along `key` from `current`, other coordinates fixed. */
export function dimNeighbor(
  items: ReadonlyArray<OutputItem>,
  current: OutputItem,
  key: string,
  delta: 1 | -1,
  wrap = false,
): OutputItem | null {
  const line = dimLine(items, current, key)
  const index = line.findIndex(([, item]) => item.taskId === current.taskId)
  if (index < 0) return null
  const next = wrap
    ? (index + delta + line.length) % line.length
    : index + delta
  const target = line.at(next)?.[1]
  return next >= 0 && target && target.taskId !== current.taskId ? target : null
}

/** Block plus all but the innermost coordinate. */
export function segmentKey(item: OutputItem): string {
  return JSON.stringify([
    item.originalBlock,
    orderDims(item.dims ?? []).slice(0, -1),
  ])
}

/** Percent-encodes `,` `;` `=` `%`. */
const encodeValue = (value: string): string =>
  value.replace(/[%,;=]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)

const decodeValue = (value: string): string =>
  value.replace(/%(25|2c|3b|3d)/gi, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )

/** `param=167,151;step=6`; values percent-encoded. */
export function parseDimFilter(raw: string | undefined): DimFilter {
  const filter: Record<string, Array<string>> = {}
  for (const entry of raw?.split(';') ?? []) {
    const [key, values = ''] = entry.split('=')
    if (key) {
      filter[key] = values
        .split(',')
        .filter((v) => v.length > 0)
        .map(decodeValue)
    }
  }
  return filter
}

export function serializeDimFilter(filter: DimFilter): string | undefined {
  const entries = Object.entries(filter)
  if (entries.length === 0) return undefined
  return entries
    .map(([key, v]) => `${key}=${v.map(encodeValue).join(',')}`)
    .join(';')
}

export function matchesDimFilter(item: OutputItem, filter: DimFilter): boolean {
  return Object.entries(filter).every(([key, values]) => {
    const value = dimValue(item, key)
    return value !== undefined && values.includes(value)
  })
}

/** Hour of day after base time, 0-23. */
export function stepHour(step: number): number {
  return ((step % 24) + 24) % 24
}

/** Forecast day: steps 24N to 24N+23. */
export function stepDay(step: number): number {
  return Math.floor(step / 24)
}

export interface StepGrid {
  days: ReadonlyArray<number>
  /** Hours of day, ascending from 0. */
  hours: ReadonlyArray<number>
}

const ascending = (a: number, b: number) => a - b

/** Day by hour-of-day layout of steps spanning days with repeating hours. */
export function stepGrid(steps: ReadonlyArray<number>): StepGrid | null {
  if (steps.length === 0 || !steps.every(Number.isFinite)) return null
  const days = [...new Set(steps.map(stepDay))].sort(ascending)
  const hours = [...new Set(steps.map(stepHour))].sort(ascending)
  return days.length > 1 && hours.length < steps.length ? { days, hours } : null
}

/** Selection as days x hours (null = all), else a count. */
export type StepSummary =
  | { days: Array<number> | null; hours: Array<number> | null }
  | { count: number }

export function summarizeSteps(
  selected: ReadonlyArray<number>,
  steps: ReadonlyArray<number>,
): StepSummary {
  const days = [...new Set(selected.map(stepDay))].sort(ascending)
  const hours = [...new Set(selected.map(stepHour))].sort(ascending)
  const inDays = (step: number) => days.includes(stepDay(step))
  const inHours = (step: number) => hours.includes(stepHour(step))
  const size = selected.length
  if (steps.filter((s) => inDays(s) && inHours(s)).length !== size) {
    return { count: size }
  }
  const wholeDays = steps.filter(inDays).length === size
  const wholeHours = steps.filter(inHours).length === size
  // Both whole (e.g. step 0 alone): describe by day.
  return {
    days: wholeHours && !wholeDays ? null : days,
    hours: wholeDays ? null : hours,
  }
}

/** Collapses consecutive numbers into ranges. */
export function formatRuns(values: ReadonlyArray<number>): string {
  const runs: Array<[number, number]> = []
  for (const value of values) {
    const last = runs.at(-1)
    if (last && value === last[1] + 1) last[1] = value
    else runs.push([value, value])
  }
  return runs
    .map(([from, to]) => (from === to ? `${from}` : `${from}\u2013${to}`))
    .join(', ')
}
