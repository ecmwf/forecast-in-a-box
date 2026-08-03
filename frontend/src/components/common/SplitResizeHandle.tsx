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

      {/* Hover hint; disappears once the divider is selected or dragged */}
      <span className="pointer-events-none absolute bottom-[calc(50%+1.5rem)] left-1/2 z-30 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within/split:opacity-0! group-hover/split:opacity-100 group-focus/split:opacity-0! group-data-[dragging]/split:opacity-0!">
        {t('split.hint')}
      </span>

      {/* Mouse-only stepper spans (widgets nested in a separator trip axe; arrows are the AT path);
          hidden via data-dragging, not :active — pressing a stepper activates the group too. */}
      {onNudge && (
        <span
          aria-hidden="true"
          data-steppers=""
          className="absolute top-1/2 left-1/2 z-30 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-3 group-focus-within/split:flex group-focus/split:flex group-data-[dragging]/split:hidden!"
        >
          <span
            title={t('split.moveLeft')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(-1)}
            className="pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-md transition-colors hover:bg-foreground/80"
          >
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span
            title={t('split.moveRight')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(1)}
            className="pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-md transition-colors hover:bg-foreground/80"
          >
            <ArrowRight className="h-4 w-4" />
          </span>
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
  const dragStartXRef = useRef<number | null>(null)
  return (
    <Separator
      onPointerDownCapture={(event) => {
        // Presses on the steppers are clicks, never drags.
        if ((event.target as HTMLElement).closest('[data-steppers]')) return
        dragStartXRef.current = event.clientX
        ;(event.currentTarget as HTMLElement).setAttribute('data-dragging', '')
      }}
      onPointerUpCapture={(event) => {
        const startX = dragStartXRef.current
        dragStartXRef.current = null
        ;(event.currentTarget as HTMLElement).removeAttribute('data-dragging')
        // The library focuses on pointer-down; blur after a real drag so only a clean click selects.
        if (startX !== null && Math.abs(event.clientX - startX) > 3) {
          ;(event.currentTarget as HTMLElement).blur()
        }
      }}
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
