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
 * Pill badge with a colored dot and label. `STATUS_BADGE_VARIANTS` is the
 * single source of status colour for plugins, schedules, artifacts and jobs.
 */

import { cn } from '@/lib/utils'

export interface StatusBadgeVariant {
  label: string
  /** Dot colour. */
  dotClass: string
  /** Pill background + text + border colour. */
  badgeClass: string
  /** Solid fill for progress bars. */
  barClass: string
}

interface StatusBadgeProps {
  variant: StatusBadgeVariant
  /** Pulse the dot for in-progress states. */
  pulse?: boolean
  className?: string
}

/** Pre-defined variants for common statuses. */
export const STATUS_BADGE_VARIANTS = {
  active: {
    dotClass: 'bg-emerald-500',
    barClass: 'bg-emerald-500',
    badgeClass:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  },
  disabled: {
    dotClass: 'bg-slate-400',
    barClass: 'bg-slate-400',
    badgeClass:
      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600',
  },
  available: {
    dotClass: 'bg-blue-400',
    barClass: 'bg-blue-500',
    badgeClass:
      'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  },
  error: {
    dotClass: 'bg-red-500',
    barClass: 'bg-red-500',
    badgeClass:
      'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 border-red-200 dark:border-red-800',
  },
  warning: {
    dotClass: 'bg-amber-500',
    barClass: 'bg-amber-500',
    badgeClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  },
} as const

export function StatusBadge({ variant, pulse, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium',
        variant.badgeClass,
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          variant.dotClass,
          pulse && 'animate-pulse',
        )}
      />
      {variant.label}
    </span>
  )
}
