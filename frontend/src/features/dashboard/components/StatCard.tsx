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
 * StatCard Component
 *
 * Displays a single statistic in the welcome card
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: ReactNode
  subtext?: string
  icon?: ReactNode
  statusDot?: 'success' | 'warning' | 'error' | 'info'
  className?: string
}

export function StatCard({
  label,
  value,
  subtext,
  icon,
  statusDot,
  className,
}: StatCardProps) {
  const statusDotColors = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    info: 'bg-blue-500 animate-pulse',
  }

  return (
    <div
      className={cn(
        'h-full rounded-lg border border-border bg-muted/50 p-4',
        className,
      )}
    >
      <div className="mb-1 flex items-start justify-between">
        <span className="text-sm tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        {statusDot && (
          <span
            className={cn('h-2 w-2 rounded-full', statusDotColors[statusDot])}
          />
        )}
        {!statusDot && icon && (
          <span className="text-muted-foreground">{icon}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-left">{value}</div>
      {subtext && (
        <div className="mt-1 text-left text-sm text-muted-foreground">
          {subtext}
        </div>
      )}
    </div>
  )
}
