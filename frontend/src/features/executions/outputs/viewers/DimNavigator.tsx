/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pause,
  Play,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dimLine, orderDims } from '../dims'
import { DimOptionsPopup } from '../DimOptionsPopup'
import { StepTimeline } from './StepTimeline'
import { kbdBadge, viewerHeaderBtn } from './viewerHeaderBtn'
import type { ReactNode } from 'react'
import type { OutputItem } from '../types'
import type { DimFormat } from '../useDimFormat'
import { Combobox, ComboboxTrigger } from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

interface DimNavigatorProps {
  item: OutputItem
  /** Outputs the controls can reach. */
  items: ReadonlyArray<OutputItem>
  format: DimFormat
  /** Innermost coordinate, played through by the play button. */
  fastKey?: string
  /** Next one out, stepped with the up/down arrow keys. */
  slowKey?: string
  playing: boolean
  canPlay: boolean
  onTogglePlay: () => void
  onSelect: (item: OutputItem) => void
}

/** Picker per coordinate; steps get a timeline. */
export function DimNavigator({
  item,
  items,
  format,
  fastKey,
  slowKey,
  playing,
  canPlay,
  onTogglePlay,
  onSelect,
}: DimNavigatorProps) {
  const { t } = useTranslation('executions')
  const stepPoints =
    fastKey === 'step'
      ? dimLine(items, item, 'step').map(([v, it]) => [Number(v), it] as const)
      : []
  const timeline =
    stepPoints.length > 1 && stepPoints.every(([s]) => Number.isFinite(s))

  const playButton = fastKey && (
    <button
      type="button"
      aria-label={
        playing
          ? t('outputs.viewer.pause')
          : t('outputs.viewer.play', { dim: format.key(fastKey) })
      }
      aria-pressed={playing}
      aria-keyshortcuts="Space"
      className={cn(
        viewerHeaderBtn,
        'w-auto shrink-0 gap-1 px-1.5',
        playing && 'bg-white/15',
      )}
      disabled={!canPlay}
      onClick={onTogglePlay}
    >
      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      <kbd className={kbdBadge}>{t('outputs.viewer.spaceKey')}</kbd>
    </button>
  )

  return (
    <div
      role="toolbar"
      aria-label={t('outputs.viewer.dimensions')}
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/10 bg-neutral-950 px-4 py-1.5 text-white"
      onClick={(e) => e.stopPropagation()}
    >
      {orderDims(item.dims ?? []).map(([key, value]) =>
        key === fastKey && timeline ? null : (
          <DimPicker
            key={key}
            dimKey={key}
            value={value}
            line={dimLine(items, item, key)}
            format={format}
            vertical={key === slowKey}
            onSelect={onSelect}
          >
            {key === fastKey && playButton}
          </DimPicker>
        ),
      )}
      {timeline && (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {playButton}
          <StepTimeline
            points={stepPoints}
            current={item}
            onSelect={onSelect}
          />
          <span className="min-w-16 shrink-0 text-right font-mono text-sm tabular-nums">
            {format.value('step', String(stepOf(stepPoints, item)), 'compact')}
          </span>
        </div>
      )}
    </div>
  )
}

function stepOf(
  points: ReadonlyArray<readonly [number, OutputItem]>,
  item: OutputItem,
): number {
  return points.find(([, it]) => it.taskId === item.taskId)?.[0] ?? NaN
}

interface DimPickerProps {
  dimKey: string
  value: string
  /** Outputs along this coordinate, other coordinates fixed. */
  line: ReadonlyArray<readonly [string, OutputItem]>
  format: DimFormat
  /** Stepped with up/down; shows the arrow-key hints. */
  vertical: boolean
  onSelect: (item: OutputItem) => void
  children?: ReactNode
}

/** Prev/next around a searchable value list. */
function DimPicker({
  dimKey,
  value,
  line,
  format,
  vertical,
  onSelect,
  children,
}: DimPickerProps) {
  const { t } = useTranslation('executions')
  const name = format.key(dimKey)
  const index = line.findIndex(([v]) => v === value)
  const prev = index > 0 ? line[index - 1][1] : null
  const next = index >= 0 && index < line.length - 1 ? line[index + 1][1] : null
  const PrevIcon = vertical ? ChevronUp : ChevronLeft
  const NextIcon = vertical ? ChevronDown : ChevronRight
  const full = (v: string) => format.value(dimKey, v, 'full')

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-sm text-white/60">{name}</span>
      <button
        type="button"
        aria-label={t('outputs.viewer.previousValue', { dim: name })}
        aria-keyshortcuts={vertical ? 'ArrowUp' : undefined}
        className={cn(viewerHeaderBtn, vertical && 'w-auto gap-1 px-1.5')}
        disabled={!prev}
        onClick={() => prev && onSelect(prev)}
      >
        <PrevIcon className="h-4 w-4" />
        {vertical && <kbd className={kbdBadge}>↑</kbd>}
      </button>
      <Combobox<string>
        autoHighlight
        items={line.map(([v]) => v)}
        value={value}
        onValueChange={(v) => {
          const target = line.find(([lv]) => lv === v)?.[1]
          if (target && v !== value) onSelect(target)
        }}
        itemToStringLabel={full}
      >
        <ComboboxTrigger
          aria-label={t('outputs.dims.some', {
            dim: name,
            values: full(value),
          })}
          className={cn(
            viewerHeaderBtn,
            'w-auto min-w-10 gap-1 px-2 font-mono text-sm [&_svg]:text-white/50',
          )}
        >
          {format.short(dimKey, value)}
        </ComboboxTrigger>
        <DimOptionsPopup
          label={full}
          // Keep keys from the viewer shortcuts.
          onInputKeyDown={(e) => e.stopPropagation()}
        />
      </Combobox>
      <button
        type="button"
        aria-label={t('outputs.viewer.nextValue', { dim: name })}
        aria-keyshortcuts={vertical ? 'ArrowDown' : undefined}
        className={cn(viewerHeaderBtn, vertical && 'w-auto gap-1 px-1.5')}
        disabled={!next}
        onClick={() => next && onSelect(next)}
      >
        {vertical && <kbd className={kbdBadge}>↓</kbd>}
        <NextIcon className="h-4 w-4" />
      </button>
      {children}
    </div>
  )
}
