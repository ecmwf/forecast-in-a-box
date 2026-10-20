/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon, ChevronDownIcon, MinusIcon } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRuns, stepDay, stepHour, summarizeSteps } from './dims'
import type { StepGrid } from './dims'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface StepGridMenuProps {
  /** Dimension name, e.g. "Step". */
  name: string
  grid: StepGrid
  /** Every step in the run, in hours. */
  steps: ReadonlyArray<number>
  /** Outputs per step under the other filters. */
  counts: ReadonlyMap<number, number>
  /** Steps with at least one output produced. */
  produced: ReadonlySet<number>
  /** Checked steps; null = all. */
  selected: ReadonlyArray<number> | null
  onChange: (next: ReadonlyArray<number> | null) => void
}

const label = 'flex items-center text-xs text-muted-foreground tabular-nums'

/** Band behind the bulk checkboxes. */
const band = 'bg-muted'

/** Above this many hour rows, rows get shorter. */
const DENSE_ROWS = 8

/** Day x hour checkbox grid of steps. */
export function StepGridMenu({
  name,
  grid,
  steps,
  counts,
  produced,
  selected,
  onChange,
}: StepGridMenuProps) {
  const { t } = useTranslation('executions')
  const checked = new Set(selected ?? steps)
  const count = (list: ReadonlyArray<number>) =>
    list.reduce((sum, step) => sum + (counts.get(step) ?? 0), 0)

  const stateOf = (group: ReadonlyArray<number>) => {
    const n = group.filter((step) => checked.has(step)).length
    return {
      checked: n === group.length,
      indeterminate: n > 0 && n < group.length,
    }
  }
  // Checks the whole group unless it is fully checked already.
  const toggle = (group: ReadonlyArray<number>) => {
    const on = !stateOf(group).checked
    const next = new Set(checked)
    for (const step of group) {
      if (on) next.add(step)
      else next.delete(step)
    }
    onChange(
      next.size === steps.length ? null : [...next].sort((a, b) => a - b),
    )
  }
  const ofDay = (day: number) => steps.filter((step) => stepDay(step) === day)
  const ofHour = (hour: number) =>
    steps.filter((step) => stepHour(step) === hour)

  const summary = selected === null ? null : summarizeSteps(selected, steps)
  const description =
    selected === null
      ? t('outputs.dims.all', { dim: name })
      : selected.length === 0
        ? t('outputs.dims.none', { dim: name })
        : t('outputs.dims.some', {
            dim: name,
            values:
              summary && 'count' in summary
                ? t('outputs.steps.stepCount', { count: summary.count })
                : [
                    summary?.days &&
                      t('outputs.steps.daysOf', {
                        count: summary.days.length,
                        days: formatRuns(summary.days),
                      }),
                    summary?.hours &&
                      t('outputs.steps.hoursOf', {
                        hours: summary.hours.join(', '),
                      }),
                  ]
                    .filter(Boolean)
                    .join(' · '),
          })

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-44 justify-between font-normal"
          />
        }
      >
        <span className="truncate">{description}</span>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      {/* Width follows the grid; text wraps. */}
      <PopoverContent align="start" className="w-auto gap-3">
        <span className="w-0 min-w-full text-muted-foreground tabular-nums">
          {t('outputs.steps.kept', {
            count: count(steps.filter((step) => checked.has(step))),
            total: count(steps),
          })}
        </span>
        <div className="max-h-[70vh] overflow-auto">
          <div
            className="grid w-max"
            style={{
              gridTemplateColumns: `auto 1.875rem repeat(${grid.days.length}, 1.875rem)`,
              gridAutoRows:
                grid.hours.length > DENSE_ROWS ? '1.25rem' : '1.5rem',
            }}
          >
            <span />
            <span />
            {grid.days.map((day) => (
              <span key={day} className={cn(label, 'justify-center')}>
                {t('outputs.steps.day', { day })}
              </span>
            ))}

            <span className={cn(label, 'justify-end pr-1')}>
              {t('outputs.steps.all')}
            </span>
            <span className={cn(band, 'rounded-tl-md')}>
              <GridCheck
                aria-label={t('outputs.steps.allAria')}
                {...stateOf(steps)}
                onToggle={() => toggle(steps)}
              />
            </span>
            {grid.days.map((day, i) => (
              <span
                key={day}
                className={cn(
                  band,
                  i === grid.days.length - 1 && 'rounded-r-md',
                )}
              >
                <GridCheck
                  aria-label={t('outputs.steps.dayAria', { day })}
                  {...stateOf(ofDay(day))}
                  onToggle={() => toggle(ofDay(day))}
                />
              </span>
            ))}

            {grid.hours.map((hour, i) => (
              <Fragment key={hour}>
                <span className={cn(label, 'justify-end pr-1')}>
                  {t('outputs.steps.hourShort', { hour })}
                </span>
                <span
                  className={cn(
                    band,
                    i === grid.hours.length - 1 && 'rounded-b-md',
                  )}
                >
                  <GridCheck
                    aria-label={t('outputs.steps.hour', { hour })}
                    {...stateOf(ofHour(hour))}
                    onToggle={() => toggle(ofHour(hour))}
                  />
                </span>
                {grid.days.map((day) => {
                  const step = steps.find(
                    (s) => stepDay(s) === day && stepHour(s) === hour,
                  )
                  return step === undefined ? (
                    <span key={day} />
                  ) : (
                    <GridCheck
                      key={day}
                      aria-label={t('outputs.steps.cell', { step })}
                      checked={checked.has(step)}
                      faded={!produced.has(step)}
                      onToggle={() => toggle([step])}
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {steps.some((step) => !produced.has(step)) && (
          <span className="w-0 min-w-full text-xs text-muted-foreground">
            {t('outputs.steps.pendingNote')}
          </span>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface GridCheckProps {
  'aria-label': string
  checked: boolean
  indeterminate?: boolean
  /** Not produced yet. */
  faded?: boolean
  onToggle: () => void
}

/** Cell-filling checkbox; dash when partly checked. */
function GridCheck({
  'aria-label': ariaLabel,
  checked,
  indeterminate = false,
  faded = false,
  onToggle,
}: GridCheckProps) {
  return (
    <CheckboxPrimitive.Root
      aria-label={ariaLabel}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={onToggle}
      className="group flex h-full w-full items-center justify-center outline-none"
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-[4px] border border-input bg-background text-foreground/80 shadow-xs transition-[color,border-color,box-shadow] group-hover:border-foreground/40 group-focus-visible:border-ring group-focus-visible:ring-3 group-focus-visible:ring-ring/50',
          faded && 'border-dashed text-muted-foreground/70',
        )}
      >
        <CheckboxPrimitive.Indicator className="flex">
          {indeterminate ? (
            <MinusIcon className="size-3" strokeWidth={2.5} />
          ) : (
            <CheckIcon className="size-3" strokeWidth={2.5} />
          )}
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  )
}
