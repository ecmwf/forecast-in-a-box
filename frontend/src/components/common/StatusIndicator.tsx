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
 * StatusIndicator Component
 *
 * Displays system status using traffic light colors (green/orange/red)
 * Supports multiple variants: dot, badge, and full
 */

import type { TrafficLightStatus } from '@/types/status.types'
import { getTrafficLightLabel } from '@/types/status.types'
import { cn } from '@/lib/utils'

interface StatusIndicatorProps {
  /** Traffic light status */
  status: TrafficLightStatus
  /** Display variant */
  variant?: 'dot' | 'badge' | 'full'
  /** Size of the indicator */
  size?: 'sm' | 'md' | 'lg'
  /** Whether to show the label */
  showLabel?: boolean
  /** Custom label (overrides default) */
  label?: string
  /** Whether to show pulse animation for green status */
  showPulse?: boolean
  /** Optional className for customization */
  className?: string
}

const dotSizeClasses = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
}

const textSizeClasses = {
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
}

const fullVariantDotSizes = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
}

const statusColors: Record<
  TrafficLightStatus,
  { bg: string; pulseRing: string; text: string; ring: string }
> = {
  unknown: {
    bg: 'bg-muted-foreground/50',
    pulseRing: 'bg-muted-foreground/20',
    text: 'text-muted-foreground',
    ring: 'ring-muted-foreground/20',
  },
  green: {
    bg: 'bg-emerald-500',
    pulseRing: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/20',
  },
  orange: {
    bg: 'bg-amber-500',
    pulseRing: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500/20',
  },
  red: {
    bg: 'bg-red-500',
    pulseRing: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    ring: 'ring-red-500/20',
  },
}

/**
 * Status indicator component with traffic light colors
 */
export function StatusIndicator({
  status,
  variant = 'badge',
  size = 'md',
  showLabel = true,
  label,
  showPulse = true,
  className,
}: StatusIndicatorProps) {
  const colors = statusColors[status]
  const displayLabel = label ?? getTrafficLightLabel(status)

  // Dot variant - just a colored dot
  // Pulse for green (heartbeat) or unknown (loading)
  if (variant === 'dot') {
    return (
      <span
        className={cn(
          'inline-block rounded-full',
          dotSizeClasses[size],
          colors.bg,
          showPulse &&
            (status === 'green' || status === 'unknown') &&
            'animate-pulse',
          className,
        )}
        aria-label={displayLabel}
      />
    )
  }

  // Badge variant - dot with label in a badge container
  // Only pulse when there's an issue (orange or red), not when normal (green)
  const shouldPulse = showPulse && status !== 'green'

  if (variant === 'badge') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-transparent bg-card ring-1 ring-foreground/5',
          showLabel ? 'py-1 pr-4 pl-2' : 'p-1.5',
          className,
        )}
      >
        <div className="relative flex size-3">
          {shouldPulse && (
            <span
              className={cn(
                'absolute inset-0 block size-full animate-pulse rounded-full duration-1500',
                colors.pulseRing,
              )}
            />
          )}
          <span
            className={cn(
              'relative m-auto block size-1 rounded-full',
              colors.bg,
            )}
          />
        </div>
        {showLabel && (
          <span className={cn('text-sm', colors.text)}>{displayLabel}</span>
        )}
      </div>
    )
  }

  // Full variant - larger display with more prominence
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5',
        'border',
        status === 'unknown' &&
          'border-muted bg-muted/50 dark:border-muted dark:bg-muted/30',
        status === 'green' &&
          'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50',
        status === 'orange' &&
          'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50',
        status === 'red' &&
          'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full',
          fullVariantDotSizes[size],
          colors.bg,
          showPulse &&
            (status === 'green' || status === 'unknown') &&
            'animate-pulse',
        )}
      />
      {showLabel && (
        <span className={cn('font-medium', textSizeClasses[size], colors.text)}>
          {displayLabel}
        </span>
      )}
    </div>
  )
}
