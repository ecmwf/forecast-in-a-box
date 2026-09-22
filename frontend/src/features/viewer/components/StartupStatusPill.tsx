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
 * Floating status pill over the map while a source's catalogue is on its
 * way: the current startup step, a dot stepper, elapsed seconds, and an
 * optional hint. Motion (ping, pulse) is `motion-safe` only.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface StartupStep {
  id: string
  label: string
}

export function StartupStatusPill({
  steps,
  activeIndex,
  hint,
}: {
  steps: ReadonlyArray<StartupStep>
  /** Steps before it are done, after it pending. */
  activeIndex: number
  hint?: string
}) {
  const { t } = useTranslation('visualise')
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [])
  const active = steps[activeIndex] ?? steps[steps.length - 1]
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <div
        role="status"
        aria-label={t('startup.status', {
          step: active.label,
          n: activeIndex + 1,
          total: steps.length,
        })}
        className="flex max-w-full items-center gap-3 rounded-full border border-border bg-background/90 px-4 py-2 text-sm shadow-lg backdrop-blur"
      >
        <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <span className="truncate font-medium">{active.label}</span>
        <ol aria-hidden className="flex shrink-0 items-center gap-1">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                i < activeIndex && 'bg-primary',
                i === activeIndex && 'bg-primary/50 motion-safe:animate-pulse',
                i > activeIndex && 'bg-border',
              )}
            />
          ))}
        </ol>
        {elapsed >= 3 && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {t('startup.elapsed', { seconds: elapsed })}
          </span>
        )}
        {hint && elapsed >= 5 && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
