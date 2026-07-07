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
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Pause,
  Play,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber, formatStep } from '../format'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

// ============================================================
// Time slider (bottom of left sidebar)
// ============================================================

/** Wall-clock interval per step when auto-playing. ~1.2s gives the user
 * time to read each frame; the loop wraps back to step 0 at the end. */
const AUTOPLAY_INTERVAL_MS = 1200

export function TimeSlider({
  steps,
  index,
  onChange,
}: {
  steps: ReadonlyArray<string>
  index: number
  onChange: (i: number) => void
}) {
  const { t } = useTranslation('executions')
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1))
  const current = steps[safeIndex] ?? ''
  const [playing, setPlaying] = useState(false)

  // Capture the latest index in a ref so the interval callback always
  // advances from the current position even though the effect itself only
  // re-runs when `playing` or `steps.length` changes.
  const indexRef = useRef(safeIndex)
  indexRef.current = safeIndex
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!playing || steps.length <= 1) return
    const id = window.setInterval(() => {
      const next = (indexRef.current + 1) % steps.length
      onChangeRef.current(next)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [playing, steps.length])

  useEffect(() => {
    if (steps.length <= 1) setPlaying(false)
  }, [steps.length])

  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('lens.time')}
          </P>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
                />
              }
            >
              <HelpCircle className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-80 whitespace-pre-line">
              {t('lens.timeHelp')}
            </TooltipContent>
          </Tooltip>
        </div>
        <span className="font-mono text-xs tabular-nums">
          {formatStep(current)}
        </span>
      </div>
      <Slider
        value={[safeIndex]}
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        onValueChange={(v) => onChange(firstNumber(v))}
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
          {safeIndex + 1} / {steps.length}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={steps.length <= 1}
            // Wrap to the last step when stepping back from the first.
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
            // Wrap to the first step when stepping forward from the last —
            // matches the autoplay behaviour so "click next, next, next"
            // cycles indefinitely.
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
