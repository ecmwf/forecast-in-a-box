/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Shared shell for the dashboard status/summary popovers. */

import type { ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface SummaryPopoverProps {
  /** Clickable trigger content. */
  trigger: ReactNode
  /** Title content — icon + text, or a Link. */
  title: ReactNode
  /** Optional header action, right-aligned (e.g. a refresh button). */
  headerAction?: ReactNode
  /** Optional footer rendered below the body. */
  footer?: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Extra classes for the popover content (e.g. a wider width). */
  contentClassName?: string
  children: ReactNode
}

export function SummaryPopover({
  trigger,
  title,
  headerAction,
  footer,
  align = 'end',
  side = 'bottom',
  contentClassName,
  children,
}: SummaryPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className="h-full cursor-pointer" />}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className={cn('w-64', contentClassName)}
      >
        <PopoverHeader>
          <div className="flex items-center justify-between">
            <PopoverTitle className="flex items-center gap-2">
              {title}
            </PopoverTitle>
            {headerAction}
          </div>
        </PopoverHeader>
        {children}
        {footer}
      </PopoverContent>
    </Popover>
  )
}
