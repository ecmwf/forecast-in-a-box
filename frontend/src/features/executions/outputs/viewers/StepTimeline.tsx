/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { dayNeighbor } from '../dims'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { OutputItem } from '../types'
import { cn } from '@/lib/utils'

interface StepTimelineProps {
  /** The current series as [step in hours, output], ascending. */
  points: ReadonlyArray<readonly [step: number, item: OutputItem]>
  current: OutputItem
  onSelect: (item: OutputItem) => void
  /** Up/down step the outer coordinate, as they do elsewhere in the viewer. */
  onVertical?: (direction: -1 | 1) => void
}

/** Max day labels; others keep just a tick. */
const MAX_DAY_LABELS = 12

/** Steps by lead time with day marks; click or drag to jump. */
export function StepTimeline({
  points,
  current,
  onSelect,
  onVertical,
}: StepTimelineProps) {
  const { t } = useTranslation('executions')
  const trackRef = useRef<HTMLDivElement>(null)
  const first = points[0]?.[0] ?? 0
  const last = points.at(-1)?.[0] ?? first
  const span = Math.max(last - first, 1)
  const at = (step: number) => `${((step - first) / span) * 100}%`
  const currentStep =
    points.find(([, item]) => item.taskId === current.taskId)?.[0] ?? first

  const firstDay = Math.ceil(first / 24)
  const lastDay = Math.floor(last / 24)
  const days = Array.from(
    { length: Math.max(0, lastDay - firstDay + 1) },
    (_, i) => firstDay + i,
  )
  const labelEvery = Math.ceil(days.length / MAX_DAY_LABELS)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      onVertical?.(e.key === 'ArrowUp' ? -1 : 1)
      return
    }
    const index = points.findIndex(([, item]) => item.taskId === current.taskId)
    const target = e.shiftKey
      ? dayTarget(points, currentStep, e.key)
      : keyTarget(points, index, e.key)
    if (target === undefined) return
    e.preventDefault()
    if (target && target.taskId !== current.taskId) onSelect(target)
  }

  const jump = (e: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const step = first + ((e.clientX - rect.left) / rect.width) * span
    let nearest = points[0]
    for (const point of points) {
      if (Math.abs(point[0] - step) < Math.abs(nearest[0] - step)) {
        nearest = point
      }
    }
    if (nearest[1].taskId !== current.taskId) onSelect(nearest[1])
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={t('outputs.viewer.timeline')}
      aria-valuemin={first}
      aria-valuemax={last}
      aria-valuenow={currentStep}
      aria-valuetext={t('outputs.dims.stepValue', { value: currentStep })}
      className="relative h-9 min-w-48 flex-1 cursor-pointer touch-none outline-offset-4 focus-visible:outline-2 focus-visible:outline-white"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) jump(e)
      }}
    >
      <span className="absolute inset-x-0 top-3 h-px bg-white/25" />
      {days.map((day, i) => (
        <span
          key={day}
          className="absolute top-1 flex -translate-x-1/2 flex-col items-center"
          style={{ left: at(day * 24) }}
        >
          <span className="h-4 w-px bg-white/25" />
          {i % labelEvery === 0 && (
            <span className="text-[10px] leading-4 text-white/50 tabular-nums">
              {t('outputs.steps.day', { day })}
            </span>
          )}
        </span>
      ))}
      {points.map(([step, item]) => (
        <span
          key={item.taskId}
          className={cn(
            'absolute top-2 h-2 w-px -translate-x-1/2',
            item.taskId === current.taskId ? 'bg-transparent' : 'bg-white/70',
          )}
          style={{ left: at(step) }}
        />
      ))}
      <span
        className="absolute top-1.5 size-3 -translate-x-1/2 rounded-full bg-white shadow"
        style={{ left: at(currentStep) }}
      />
    </div>
  )
}

type Points = StepTimelineProps['points']

/** Slider keys; undefined for other keys, null past either end. */
function keyTarget(
  points: Points,
  index: number,
  key: string,
): OutputItem | null | undefined {
  const to: Partial<Record<string, number>> = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    Home: 0,
    End: points.length - 1,
  }
  const at = to[key]
  return at === undefined ? undefined : (points[at]?.[1] ?? null)
}

/** Shift+arrows; undefined for other keys. */
function dayTarget(
  points: Points,
  step: number,
  key: string,
): OutputItem | null | undefined {
  if (key === 'ArrowRight') return dayNeighbor(points, step, 1)
  if (key === 'ArrowLeft') return dayNeighbor(points, step, -1)
  return undefined
}
