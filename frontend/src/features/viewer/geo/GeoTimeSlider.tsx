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
 * Time control for the compare viewer. The link-mode select decides how
 * the two sources follow the shared axis: exact (identical instants or
 * hidden), nearest (snap within tolerance, offsets tagged on the
 * panels), offset (B follows A at a fixed user-set Δ), independent (two
 * axes, manual overlay). Availability renders as contiguous runs so a
 * 50+-step external source stays legible.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber, formatStep } from '../format'
import { availabilityRange, overlapRange } from './compare-timeline'
import { TIME_LINK_MODES } from './time-link'
import type { CompareTimeline } from './compare-timeline'
import type { SourceSlot } from './layer-pairing'
import type { TimeLinkMode } from './time-link'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const AUTOPLAY_INTERVAL_MS = 1200
const HOUR_MS = 3600_000

const TRACK_ON_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600 dark:bg-blue-500',
  b: 'bg-orange-600 dark:bg-orange-500',
}

export interface IndependentAxis {
  epochs: ReadonlyArray<number>
  index: number
  onChange: (index: number) => void
}

/** Offset-slider range/step and alignment presets, from the raw indexes. */
export interface OffsetMeta {
  minMs: number
  maxMs: number
  stepMs: number
  /** null while either axis is empty. */
  alignStartsMs: number | null
  alignEndsMs: number | null
}

export function GeoTimeSlider({
  hasB = true,
  timeline,
  index,
  onChange,
  linkMode,
  onLinkModeChange,
  offsetMs,
  onOffsetChange,
  offsetMeta,
  independent,
  clip,
  onClipChange,
  hoverTimes,
}: {
  /** Solo hides the link select, B track, and B/A∩B clip presets. */
  hasB?: boolean
  timeline: CompareTimeline
  index: number
  onChange: (index: number) => void
  linkMode: TimeLinkMode
  onLinkModeChange: (mode: TimeLinkMode) => void
  /** B's lag relative to A in `offset` mode. */
  offsetMs: number
  onOffsetChange: (ms: number) => void
  offsetMeta: OffsetMeta
  /** Per-source axes for `independent` mode. */
  independent: Record<SourceSlot, IndependentAxis>
  /** Union-index window the whole control operates in (null = all). */
  clip: [number, number] | null
  onClipChange: (clip: [number, number] | null) => void
  /** Per-side resolved instants for a hovered axis epoch (offset/nearest
   *  modes); null → show the plain axis instant. */
  hoverTimes: (epoch: number) => { a: string | null; b: string | null } | null
}) {
  const { t } = useTranslation('executions')
  const { t: tCompare } = useTranslation('visualise')
  const steps = timeline.epochs
  // The clip window: every control (slider, tracks, autoplay, stepper)
  // operates inside it — the focus+context pattern from time-series UIs.
  const rangeStart = clip ? Math.max(0, clip[0]) : 0
  const rangeEnd = clip ? Math.min(steps.length - 1, clip[1]) : steps.length - 1
  const rangeLen = Math.max(1, rangeEnd - rangeStart + 1)
  const safeIndex = Math.max(rangeStart, Math.min(index, rangeEnd))
  const [playing, setPlaying] = useState(false)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const indexRef = useRef(safeIndex)
  indexRef.current = safeIndex
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!playing || steps.length <= 1 || linkMode === 'independent') return
    const id = window.setInterval(() => {
      const current = indexRef.current
      onChangeRef.current(current >= rangeEnd ? rangeStart : current + 1)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [playing, steps.length, linkMode, rangeStart, rangeEnd])

  useEffect(() => {
    if (steps.length <= 1) setPlaying(false)
  }, [steps.length])

  const hasSharedAxis = linkMode !== 'independent' && steps.length > 0
  if (linkMode !== 'independent' && steps.length === 0) return null

  return (
    <div className="space-y-2 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {tCompare('timeline.label')}
        </span>
        <div className="flex items-center gap-2">
          {hasB && (
            <Select
              value={linkMode}
              onValueChange={(v) => {
                if (v !== null) onLinkModeChange(v)
              }}
            >
              <SelectTrigger
                className="h-7 w-40 text-xs"
                aria-label={tCompare('timeline.linkAria')}
              >
                <SelectValue>
                  {tCompare(`timeline.link.${linkMode}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIME_LINK_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {tCompare(`timeline.link.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasSharedAxis && (
            <span className="font-mono text-xs tabular-nums">
              {formatStep(new Date(steps[safeIndex]).toISOString())}
            </span>
          )}
        </div>
      </div>

      {linkMode === 'offset' && (
        <OffsetControl
          offsetMs={offsetMs}
          onOffsetChange={onOffsetChange}
          meta={offsetMeta}
        />
      )}

      {linkMode === 'independent' ? (
        <div className="space-y-2">
          {(['a', 'b'] as const).map((slot) => (
            <IndependentSlider
              key={slot}
              slot={slot}
              axis={independent[slot]}
            />
          ))}
        </div>
      ) : (
        <>
          <Slider
            value={[safeIndex]}
            min={rangeStart}
            max={rangeEnd}
            step={1}
            onValueChange={(v) => onChange(firstNumber(v))}
          />
          {/* Per-source availability tracks. Hover shows the instant and
              a shared cursor; click jumps to that step. */}
          <div className="relative grid grid-cols-[14px_1fr] items-center gap-x-2 gap-y-1">
            {(() => {
              const hovered =
                hoverIndex !== null && hoverIndex < steps.length
                  ? {
                      fraction:
                        rangeLen > 1
                          ? (hoverIndex - rangeStart) / (rangeLen - 1)
                          : 0,
                      epoch: steps[hoverIndex],
                      perSide: hoverTimes(steps[hoverIndex]),
                    }
                  : null
              return (
                <>
                  {hovered && hovered.perSide === null && (
                    <HoverTooltip
                      fraction={hovered.fraction}
                      epoch={hovered.epoch}
                    />
                  )}
                  {(hasB ? (['a', 'b'] as const) : (['a'] as const)).map(
                    (slot) => (
                    <SlotRunTrack
                      key={slot}
                      slot={slot}
                      availability={timeline.availability[slot].slice(
                        rangeStart,
                        rangeEnd + 1,
                      )}
                      currentIndex={safeIndex - rangeStart}
                      hoverIndex={
                        hoverIndex === null ? null : hoverIndex - rangeStart
                      }
                      hoverLabel={hovered?.perSide?.[slot] ?? null}
                      onHover={(i) =>
                        setHoverIndex(i === null ? null : i + rangeStart)
                      }
                      onJump={(i) => onChange(i + rangeStart)}
                    />
                    ),
                  )}
                </>
              )
            })()}
          </div>
          <TimeClipRow
            hasB={hasB}
            timeline={timeline}
            clip={clip}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onClipChange={onClipChange}
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant={playing ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              disabled={steps.length <= 1}
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? t('lens.pause') : t('lens.play')}
            >
              {playing ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {safeIndex - rangeStart + 1} / {rangeLen}
              {clip && (
                <span className="ml-1 text-muted-foreground/70">
                  ({steps.length})
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={steps.length <= 1}
                onClick={() =>
                  onChange(safeIndex <= rangeStart ? rangeEnd : safeIndex - 1)
                }
                aria-label={t('lens.prevStep')}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={steps.length <= 1}
                onClick={() =>
                  onChange(safeIndex >= rangeEnd ? rangeStart : safeIndex + 1)
                }
                aria-label={t('lens.nextStep')}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** One source's own axis for independent mode. */
function IndependentSlider({
  slot,
  axis,
}: {
  slot: SourceSlot
  axis: IndependentAxis
}) {
  const { t } = useTranslation('visualise')
  if (axis.epochs.length === 0) return null
  const safe = Math.max(0, Math.min(axis.index, axis.epochs.length - 1))
  return (
    <label className="grid grid-cols-[14px_1fr_auto] items-center gap-x-2">
      <span className="text-right font-mono text-[10px] font-bold text-muted-foreground">
        {slot.toUpperCase()}
      </span>
      <span className="sr-only">
        {t('timeline.independentAria', { slot: slot.toUpperCase() })}
      </span>
      <Slider
        value={[safe]}
        min={0}
        max={Math.max(0, axis.epochs.length - 1)}
        step={1}
        onValueChange={(v) => axis.onChange(firstNumber(v))}
      />
      <span className="font-mono text-xs tabular-nums">
        {formatStep(new Date(axis.epochs[safe]).toISOString())}
      </span>
    </label>
  )
}

function formatHours(ms: number): string {
  const hours = ms / HOUR_MS
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

/**
 * Offset Δ control: slider over the intersecting range, alignment
 * presets, and an exact hours field. The field is a plain text input —
 * type=number fights partial edits ('048', hard to clear) — and mirrors
 * `offsetMs` except while being edited.
 */
function OffsetControl({
  offsetMs,
  onOffsetChange,
  meta,
}: {
  offsetMs: number
  onOffsetChange: (ms: number) => void
  meta: OffsetMeta
}) {
  const { t } = useTranslation('visualise')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const shownText = editing ? text : formatHours(offsetMs)

  const preset = (label: string, ms: number | null, title: string) => (
    <button
      type="button"
      disabled={ms === null}
      onClick={() => {
        if (ms !== null) onOffsetChange(ms)
      }}
      title={title}
      aria-pressed={ms !== null && offsetMs === ms}
      className={cn(
        'rounded border border-border px-1.5 py-0.5 text-[10px] font-medium',
        'disabled:opacity-40',
        ms !== null && offsetMs === ms ? 'bg-accent' : 'hover:bg-accent',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('timeline.offsetLabel')}
      </span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('timeline.offsetSliderAria')}</span>
        <Slider
          value={[Math.min(meta.maxMs, Math.max(meta.minMs, offsetMs))]}
          min={meta.minMs}
          max={meta.maxMs}
          step={meta.stepMs}
          className="[&_[data-slot=slider-range]]:bg-muted-foreground/50 [&_[data-slot=slider-thumb]]:border-muted-foreground [&_[data-slot=slider-thumb]]:bg-muted"
          onValueChange={(v) => onOffsetChange(firstNumber(v))}
        />
      </label>
      <span className="flex shrink-0 items-center gap-1">
        {preset('0', 0, t('timeline.offsetZeroHint'))}
        {preset(
          t('timeline.alignStarts'),
          meta.alignStartsMs,
          t('timeline.alignStartsHint'),
        )}
        {preset(
          t('timeline.alignEnds'),
          meta.alignEndsMs,
          t('timeline.alignEndsHint'),
        )}
      </span>
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="sr-only">{t('timeline.offsetLabel')}</span>
        <Input
          type="text"
          inputMode="decimal"
          value={shownText}
          onFocus={(e) => {
            setText(formatHours(offsetMs))
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const value = e.target.value
            if (!/^-?\d*(\.\d*)?$/.test(value)) return
            setText(value)
            onOffsetChange(Math.round((Number(value) || 0) * HOUR_MS))
          }}
          className="h-7 w-16 text-xs"
        />
        h
      </label>
    </div>
  )
}

/** Edge-aware translate class for a cursor-anchored label. */
function anchorClass(fraction: number): string {
  return fraction < 0.08
    ? 'translate-x-0'
    : fraction > 0.92
      ? '-translate-x-full'
      : '-translate-x-1/2'
}

/** Single-instant hover tooltip (exact mode — both sides identical). */
function HoverTooltip({
  fraction,
  epoch,
}: {
  fraction: number
  epoch: number
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-full z-10 mb-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs whitespace-nowrap shadow-sm',
        anchorClass(fraction),
      )}
      style={{ left: `calc(22px + ${fraction * 100} * (100% - 22px) / 100)` }}
    >
      {formatStep(new Date(epoch).toISOString())}
    </div>
  )
}

/** Individual step cells become merged runs above this count. */
const TRACK_CELL_LIMIT = 240

/**
 * One source's availability track: discrete cells (gap = countable steps)
 * up to TRACK_CELL_LIMIT, merged runs beyond. Hover previews the instant
 * across both tracks; click jumps to it.
 */
function SlotRunTrack({
  slot,
  availability,
  currentIndex,
  hoverIndex,
  hoverLabel,
  onHover,
  onJump,
}: {
  slot: SourceSlot
  availability: ReadonlyArray<boolean>
  currentIndex: number
  hoverIndex: number | null
  /** This side's resolved instant at the hovered position, when the
   *  time-link policy splits the sides ('—' = no data). */
  hoverLabel: string | null
  onHover: (index: number | null) => void
  onJump: (index: number) => void
}) {
  const { t } = useTranslation('visualise')
  const cells = availability.length <= TRACK_CELL_LIMIT
  const runs = useMemo(() => {
    if (cells) return null
    const out: Array<{ available: boolean; length: number }> = []
    for (const available of availability) {
      const last = out.at(-1)
      if (last && last.available === available) last.length++
      else out.push({ available, length: 1 })
    }
    return out
  }, [availability, cells])
  const pct = (index: number) =>
    availability.length > 1 ? (index / (availability.length - 1)) * 100 : 0

  const indexFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return Math.round(frac * (availability.length - 1))
  }

  return (
    <>
      <span className="text-right font-mono text-[10px] font-bold text-muted-foreground">
        {slot.toUpperCase()}
      </span>
      <div
        role="img"
        aria-label={t('timeline.trackAria', { slot: slot.toUpperCase() })}
        className="relative flex h-2 cursor-pointer items-stretch gap-px py-0"
        onPointerMove={(e) => onHover(indexFromPointer(e))}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const frac = Math.min(
            1,
            Math.max(0, (e.clientX - rect.left) / rect.width),
          )
          onJump(Math.round(frac * (availability.length - 1)))
        }}
      >
        {cells
          ? availability.map((available, i) => (
              <span
                key={i}
                className={cn(
                  'min-w-0 flex-1 rounded-[1px]',
                  available
                    ? TRACK_ON_CLASS[slot]
                    : 'bg-border/60 dark:bg-border/40',
                )}
              />
            ))
          : runs?.map((run, i) => (
              <span
                key={i}
                style={{ flexGrow: run.length }}
                className={cn(
                  'min-w-0 basis-0 rounded-sm',
                  run.available
                    ? TRACK_ON_CLASS[slot]
                    : 'border border-dashed border-border bg-transparent',
                )}
              />
            ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: `${pct(currentIndex)}%` }}
        />
        {hoverIndex !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-px -translate-x-1/2 bg-foreground/50"
            style={{ left: `${pct(hoverIndex)}%` }}
          />
        )}
        {/* A's instant rides above its bar, B's below — labels live with
            their tracks instead of one wide combined box. */}
        {hoverIndex !== null && hoverLabel !== null && (
          <span
            className={cn(
              'pointer-events-none absolute z-10 rounded border border-border bg-background px-1 py-px font-mono text-[10px] whitespace-nowrap shadow-sm',
              slot === 'a' ? 'bottom-full mb-0.5' : 'top-full mt-0.5',
              anchorClass(
                availability.length > 1
                  ? hoverIndex / (availability.length - 1)
                  : 0,
              ),
            )}
            style={{ left: `${pct(hoverIndex)}%` }}
          >
            {hoverLabel}
          </span>
        )}
      </div>
    </>
  )
}

/**
 * Focus window over the union axis: a dual-thumb range with one-click
 * presets — All, A's range, B's range, A∩B — because dragging thumbs
 * precisely across thousands of steps is not a real workflow. Sub-pixel
 * availability (a 60-step run inside a 4,000-step union) becomes
 * visible by clipping to it.
 */
function TimeClipRow({
  hasB,
  timeline,
  clip,
  rangeStart,
  rangeEnd,
  onClipChange,
}: {
  hasB: boolean
  timeline: CompareTimeline
  clip: [number, number] | null
  rangeStart: number
  rangeEnd: number
  onClipChange: (clip: [number, number] | null) => void
}) {
  const { t } = useTranslation('visualise')
  const last = timeline.epochs.length - 1
  if (last < 1) return null
  const rangeA = availabilityRange(timeline.availability.a)
  const rangeB = availabilityRange(timeline.availability.b)
  const rangeBoth = overlapRange(
    timeline.availability.a,
    timeline.availability.b,
  )

  const apply = (range: [number, number] | null) => {
    if (!range || (range[0] === 0 && range[1] === last)) onClipChange(null)
    else onClipChange(range)
  }

  const preset = (
    label: string,
    range: [number, number] | null,
    title: string,
  ) => (
    <button
      type="button"
      disabled={!range}
      onClick={() => apply(range)}
      title={title}
      aria-pressed={
        clip !== null && range !== null
          ? clip[0] === range[0] && clip[1] === range[1]
          : false
      }
      className={cn(
        'rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-bold',
        'disabled:opacity-40',
        clip !== null &&
          range !== null &&
          clip[0] === range[0] &&
          clip[1] === range[1]
          ? 'bg-accent'
          : 'hover:bg-accent',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('timeline.clipLabel')}
      </span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('timeline.clipAria')}</span>
        {/* Neutral styling — a primary-colored fill reads as "layer A
            blue" next to the availability tracks. */}
        <Slider
          value={[rangeStart, rangeEnd]}
          min={0}
          max={last}
          step={1}
          className="[&_[data-slot=slider-range]]:bg-muted-foreground/50 [&_[data-slot=slider-thumb]]:border-muted-foreground [&_[data-slot=slider-thumb]]:bg-muted"
          onValueChange={(v) => {
            if (Array.isArray(v) && v.length === 2) {
              apply([Math.min(v[0], v[1]), Math.max(v[0], v[1])])
            }
          }}
        />
      </label>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatStep(new Date(timeline.epochs[rangeStart]).toISOString())}
        {' – '}
        {formatStep(new Date(timeline.epochs[rangeEnd]).toISOString())}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onClipChange(null)}
          aria-pressed={clip === null}
          className={cn(
            'rounded border border-border px-1.5 py-0.5 text-[10px] font-medium',
            clip === null ? 'bg-accent' : 'hover:bg-accent',
          )}
        >
          {t('timeline.clipAll')}
        </button>
        {/* Solo: the union IS A's range, so the slot presets are noise. */}
        {hasB && preset('A', rangeA, t('timeline.clipHint', { slot: 'A' }))}
        {hasB && preset('B', rangeB, t('timeline.clipHint', { slot: 'B' }))}
        {hasB && preset('A∩B', rangeBoth, t('timeline.clipBothHint'))}
      </span>
    </div>
  )
}
