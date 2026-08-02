/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Separator } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/** Grip + hover hint + step-buttons-on-select; host must be relative with class `group/split`. */
export function SplitHandleChrome({
  onNudge,
}: {
  /** Step the divider one notch; -1 = towards the first pane. */
  onNudge?: (direction: -1 | 1) => void
}) {
  const { t } = useTranslation('common')

  return (
    <>
      {/* Grip marker */}
      <span className="pointer-events-none absolute top-1/2 left-1/2 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60" />

      {/* Hover hint; disappears once the divider is selected */}
      <span className="pointer-events-none absolute bottom-[calc(50%+1.5rem)] left-1/2 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within/split:opacity-0! group-hover/split:opacity-100 group-focus/split:opacity-0!">
        {t('split.hint')}
      </span>

      {/* Step buttons while selected */}
      {onNudge && (
        <span className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-3 group-focus-within/split:flex group-focus/split:flex">
          <button
            type="button"
            aria-label={t('split.moveLeft')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(-1)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-colors hover:bg-foreground/80"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t('split.moveRight')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(1)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-colors hover:bg-foreground/80"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </span>
      )}
    </>
  )
}

/** Panel-group Separator with the chrome: drag, or click to select and step. */
export function SplitResizeHandle({
  onNudge,
  className,
}: {
  onNudge?: (direction: -1 | 1) => void
  className?: string
}) {
  return (
    <Separator
      className={cn(
        'group/split relative w-4 shrink-0 cursor-col-resize outline-none',
        'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border',
        'hover:before:w-0.5 hover:before:bg-primary/50',
        'focus-within:before:w-0.5 focus-within:before:bg-primary focus:before:w-0.5 focus:before:bg-primary',
        className,
      )}
    >
      <SplitHandleChrome onNudge={onNudge} />
    </Separator>
  )
}
