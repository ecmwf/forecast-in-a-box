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
 * Shared valid-time control over the UNION of both sources' time steps,
 * with a per-source availability track (solid = has data at that instant,
 * hollow = gap). Autoplay loops the union; sources missing the current
 * instant are hidden by the map components, never silently substituted.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber, formatStep } from '../format'
import type { CompareTimeline } from './compare-timeline'
import type { SourceSlot } from './layer-pairing'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const AUTOPLAY_INTERVAL_MS = 1200

const TRACK_ON_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600 dark:bg-blue-500',
  b: 'bg-orange-600 dark:bg-orange-500',
}

export function CompareTimeSlider({
  timeline,
  index,
  onChange,
}: {
  timeline: CompareTimeline
  index: number
  onChange: (index: number) => void
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
    if (!playing || steps.length <= 1) return
    const id = window.setInterval(() => {
      onChangeRef.current((indexRef.current + 1) % steps.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [playing, steps.length])

  useEffect(() => {
    if (steps.length <= 1) setPlaying(false)
  }, [steps.length])

  if (steps.length === 0) return null
  const current = steps[safeIndex]

  return (
    <div className="space-y-2 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <P2>{tCompare('timeline.label')}</P2>
        <span className="font-mono text-xs tabular-nums">
          {formatStep(new Date(current).toISOString())}
        </span>
      </div>
      <Slider
        value={[safeIndex]}
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        onValueChange={(v) => onChange(firstNumber(v))}
      />
      {/* Availability tracks — one row per source over the union. */}
      <div className="grid grid-cols-[14px_1fr] items-center gap-x-2 gap-y-1">
        {(['a', 'b'] as const).map((slot) => (
          <SlotTrack
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
    </div>
  )
}

function SlotTrack({
  slot,
  availability,
  currentIndex,
}: {
  slot: SourceSlot
  availability: ReadonlyArray<boolean>
  currentIndex: number
}) {
  const { t } = useTranslation('compare')
  return (
    <>
      <span className="text-right font-mono text-[10px] font-bold text-muted-foreground">
        {slot.toUpperCase()}
      </span>
      <div
        role="img"
        aria-label={t('timeline.trackAria', { slot: slot.toUpperCase() })}
        className="flex gap-px"
      >
        {availability.map((available, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 min-w-0 flex-1 rounded-sm',
              available
                ? TRACK_ON_CLASS[slot]
                : 'border border-dashed border-border bg-transparent',
              i === currentIndex && 'ring-1 ring-foreground ring-offset-1',
            )}
          />
        ))}
      </div>
    </>
  )
}

function P2({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  )
}
