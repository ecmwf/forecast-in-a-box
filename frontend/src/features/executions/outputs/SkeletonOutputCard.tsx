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
 * Pending-output placeholder. Matches OutputCard dimensions so the grid
 * doesn't reshuffle when an output's `is_available` flips to true.
 */

import { Skeleton } from '@/components/ui/skeleton'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface SkeletonOutputCardProps {
  originalBlock: string
  /** Pulse only fires for currently-executing blocks; idle pending cards stay static. */
  isRunning?: boolean
}

// Stronger pulse than Tailwind's default — see `pulse-strong` in styles.css.
const RUNNING_PULSE = 'animate-[pulse-strong_1.5s_ease-in-out_infinite]'

export function SkeletonOutputCard({
  originalBlock,
  isRunning = false,
}: SkeletonOutputCardProps) {
  const pulse = isRunning ? RUNNING_PULSE : 'animate-none'
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-full space-y-2 overflow-hidden rounded-lg border bg-card p-3"
    >
      <Skeleton className={cn('aspect-video w-full rounded', pulse)} />

      <div className="space-y-1">
        <Skeleton className={cn('h-4 w-3/4', pulse)} />
        <P
          className="truncate font-mono text-xs text-muted-foreground/70"
          title={originalBlock}
        >
          {originalBlock}
        </P>
      </div>

      <div className="flex gap-1.5">
        <Skeleton className={cn('h-7 w-9', pulse)} />
        <Skeleton className={cn('h-7 w-9', pulse)} />
      </div>
    </div>
  )
}
