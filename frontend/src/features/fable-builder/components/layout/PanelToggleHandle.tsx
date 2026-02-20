/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface PanelToggleHandleProps {
  isOpen: boolean
  onToggle: () => void
  position: 'left' | 'right'
  label: string
}

export function PanelToggleHandle({
  isOpen,
  onToggle,
  position,
  label,
}: PanelToggleHandleProps): ReactNode {
  // Icon logic:
  // Left panel: ChevronLeft when open (collapse left), ChevronRight when closed (expand right)
  // Right panel: ChevronRight when open (collapse right), ChevronLeft when closed (expand left)
  const Icon =
    position === 'left'
      ? isOpen
        ? ChevronLeft
        : ChevronRight
      : isOpen
        ? ChevronRight
        : ChevronLeft

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn(
              'absolute top-1/2 z-20 -translate-y-1/2',
              'rounded-sm border border-border bg-muted/50 hover:bg-muted',
              'transition-all duration-150',
              // Size: larger when closed for better touch target
              isOpen ? 'h-12 w-4' : 'h-16 w-6',
              // Position: adjust for size change
              position === 'left'
                ? isOpen
                  ? '-right-2'
                  : '-right-3'
                : isOpen
                  ? '-left-2'
                  : '-left-3',
            )}
            aria-label={label}
            aria-expanded={isOpen}
          />
        }
      >
        <Icon className={cn(isOpen ? 'h-3 w-3' : 'h-4 w-4')} />
      </TooltipTrigger>
      <TooltipContent side={position === 'left' ? 'right' : 'left'}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
