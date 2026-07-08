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

export function CompareTimeSlider({
  timeline,
  index,
  onChange,
  linkMode,
  onLinkModeChange,
  offsetMs,
  onOffsetChange,
  independent,
}: {
  timeline: CompareTimeline
  index: number
  onChange: (index: number) => void
  linkMode: TimeLinkMode
  onLinkModeChange: (mode: TimeLinkMode) => void
  /** B's lag relative to A in `offset` mode. */
  offsetMs: number
  onOffsetChange: (ms: number) => void
  /** Per-source axes for `independent` mode. */
  independent: Record<SourceSlot, IndependentAxis>
}) {
  const { t } = useTranslation('executions')
  const { t: tCompare } = useTranslation('compare')
  const steps = timeline.epochs
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1))
  const [playing, setPlaying] = useState(false)

  const indexRef = useRef(safeIndex)
  indexRef.current = safeIndex
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!playing || steps.length <= 1 || linkMode === 'independent') return
    const id = window.setInterval(() => {
      onChangeRef.current((indexRef.current + 1) % steps.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [playing, steps.length, linkMode])

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
          <Select
            value={linkMode}
            onValueChange={(v) => {
              if (typeof v === 'string' && v) {
                onLinkModeChange(v as TimeLinkMode)
              }
            }}
          >
            <SelectTrigger
              className="h-7 w-40 text-xs"
              aria-label={tCompare('timeline.linkAria')}
            >
              <SelectValue>{tCompare(`timeline.link.${linkMode}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TIME_LINK_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {tCompare(`timeline.link.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {linkMode === 'offset' && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {tCompare('timeline.offsetLabel')}
              <Input
                type="number"
                step={1}
                value={Math.round(offsetMs / HOUR_MS)}
                onChange={(e) =>
                  onOffsetChange(Number(e.target.value) * HOUR_MS)
                }
                className="h-7 w-16 text-xs"
              />
              h
            </label>
          )}
          {hasSharedAxis && (
            <span className="font-mono text-xs tabular-nums">
              {formatStep(new Date(steps[safeIndex]).toISOString())}
            </span>
          )}
        </div>
      </div>

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
            min={0}
            max={Math.max(0, steps.length - 1)}
            step={1}
            onValueChange={(v) => onChange(firstNumber(v))}
          />
          {/* Availability runs — contiguous spans per source, with a
              cursor line at the current step. */}
          <div className="grid grid-cols-[14px_1fr] items-center gap-x-2 gap-y-1">
            {(['a', 'b'] as const).map((slot) => (
              <SlotRunTrack
                key={slot}
                slot={slot}
                availability={timeline.availability[slot]}
                currentIndex={safeIndex}
              />
            ))}
          </div>
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
              {safeIndex + 1} / {steps.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={steps.length <= 1}
                onClick={() =>
                  onChange((safeIndex - 1 + steps.length) % steps.length)
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
                onClick={() => onChange((safeIndex + 1) % steps.length)}
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
  const { t } = useTranslation('compare')
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

/** Availability as merged runs (solid span = data, dashed = gap). */
function SlotRunTrack({
  slot,
  availability,
  currentIndex,
}: {
  slot: SourceSlot
  availability: ReadonlyArray<boolean>
  currentIndex: number
}) {
  const { t } = useTranslation('compare')
  const runs = useMemo(() => {
    const out: Array<{ available: boolean; length: number }> = []
    for (const available of availability) {
      const last = out[out.length - 1]
      if (last && last.available === available) last.length++
      else out.push({ available, length: 1 })
    }
    return out
  }, [availability])
  const cursorPct =
    availability.length > 1
      ? (currentIndex / (availability.length - 1)) * 100
      : 0

  return (
    <>
      <span className="text-right font-mono text-[10px] font-bold text-muted-foreground">
        {slot.toUpperCase()}
      </span>
      <div
        role="img"
        aria-label={t('timeline.trackAria', { slot: slot.toUpperCase() })}
        className="relative flex h-1.5 gap-px"
      >
        {runs.map((run, i) => (
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
          className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: `${cursorPct}%` }}
        />
      </div>
    </>
  )
}
