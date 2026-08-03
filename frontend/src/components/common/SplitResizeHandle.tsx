/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
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

/** Two-pane horizontal split with the shared handle: drag, clean-click select,
 * arrow keys, steppers, double-click reset. Uncontrolled; reports percentages. */
export function SplitPane({
  initialStartPct,
  defaultStartPct = 42,
  onChange,
  minStartPx,
  minEndPx,
  start,
  end,
  className,
}: {
  /** Restored width of the first pane in percent; falls back to the default. */
  initialStartPct?: number
  defaultStartPct?: number
  onChange?: (startPct: number) => void
  minStartPx: number
  minEndPx: number
  start: ReactNode
  end: ReactNode
  className?: string
}) {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const startPaneRef = useRef<HTMLDivElement>(null)
  const endPaneRef = useRef<HTMLDivElement>(null)
  const [startPct, setStartPct] = useState(initialStartPct ?? defaultStartPct)
  const startPctRef = useRef(startPct)

  const clampPct = (pct: number, width: number): number => {
    if (width <= 0) return pct
    const min = (minStartPx / width) * 100
    const max = 100 - (minEndPx / width) * 100
    return max < min ? min : Math.min(max, Math.max(min, pct))
  }

  const apply = (pct: number): void => {
    const next = clampPct(pct, containerRef.current?.clientWidth ?? 0)
    startPctRef.current = next
    setStartPct(next)
    onChange?.(next)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const strip = e.currentTarget as HTMLElement
    const width = containerRef.current?.clientWidth ?? 0
    if (width === 0) return
    strip.setAttribute('data-dragging', '')
    const startX = e.clientX
    const startAt = startPctRef.current
    let moved = false
    let raf = 0
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (Math.abs(dx) > 3) moved = true
      startPctRef.current = clampPct(startAt + (dx / width) * 100, width)
      // DOM-only, one write per frame — per-move React commits (and storage writes) stutter.
      raf ||= requestAnimationFrame(() => {
        raf = 0
        const pct = startPctRef.current
        if (startPaneRef.current) {
          startPaneRef.current.style.flexGrow = String(pct)
        }
        if (endPaneRef.current) {
          endPaneRef.current.style.flexGrow = String(100 - pct)
        }
      })
    }
    const onUp = () => {
      cancelAnimationFrame(raf)
      strip.removeAttribute('data-dragging')
      // Commit once: state, persistence, aria — the drag itself was DOM-only.
      apply(startPctRef.current)
      // Only a clean click selects (shows the steppers); a drag never pins them.
      if (!moved) strip.focus()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return (
    <div ref={containerRef} className={cn('flex min-w-0', className)}>
      <div
        ref={startPaneRef}
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flexGrow: startPct, flexBasis: 0, minWidth: minStartPx }}
      >
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('split.resize')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(startPct)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={() => apply(defaultStartPct)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            apply(startPctRef.current + (e.key === 'ArrowRight' ? 2 : -2))
          }
        }}
        className={cn(
          'group/split relative w-4 shrink-0 cursor-col-resize outline-none',
          'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border',
          'hover:before:w-0.5 hover:before:bg-primary/50',
          'focus-within:before:w-0.5 focus-within:before:bg-primary focus:before:w-0.5 focus:before:bg-primary',
        )}
      >
        <SplitHandleChrome
          onNudge={(direction) => apply(startPctRef.current + direction * 8)}
        />
      </div>
      <div
        ref={endPaneRef}
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flexGrow: 100 - startPct, flexBasis: 0, minWidth: minEndPx }}
      >
        {end}
      </div>
    </div>
  )
}
