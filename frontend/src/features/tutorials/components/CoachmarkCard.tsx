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
 * Coachmark chrome: a trigger-less non-modal popover on a real element, or
 * the same card centered when there is nothing to anchor. Popover close
 * requests (outside press, Escape) are ignored — quitting is the runner's.
 */

import { Popover, PopoverContent } from '@/components/ui/popover'

const CARD_CLASS = 'w-80 gap-3 shadow-xl'

export function CoachmarkCard({
  element,
  side = 'bottom',
  align = 'center',
  labelledBy,
  children,
}: {
  element: Element | null
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  labelledBy: string
  children: React.ReactNode
}) {
  if (element === null) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center p-4">
        <div
          role="dialog"
          aria-labelledby={labelledBy}
          data-tour-card=""
          className={`pointer-events-auto flex flex-col rounded-md bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 ${CARD_CLASS}`}
        >
          {children}
        </div>
      </div>
    )
  }
  return (
    <Popover open onOpenChange={() => {}}>
      <PopoverContent
        anchor={element}
        side={side}
        align={align}
        sideOffset={10}
        positionerClassName="z-[70]"
        role="dialog"
        aria-labelledby={labelledBy}
        data-tour-card=""
        className={CARD_CLASS}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
