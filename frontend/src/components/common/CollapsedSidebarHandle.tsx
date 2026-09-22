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
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Thin vertical strip rendered in place of a sidebar when the user
 * collapses it. Holds a single chevron button that re-expands the panel.
 * The chevron points toward the viewport-centre to suggest "open this way".
 */
export function CollapsedSidebarHandle({
  side,
  onExpand,
  label,
  buttonAttrs,
}: {
  side: 'left' | 'right'
  onExpand: () => void
  /** Accessible name; defaults to the generic expand label. */
  label?: string
  /** Extra `data-*` attributes for the expand button (test/tour hooks). */
  buttonAttrs?: Record<`data-${string}`, string | undefined>
}) {
  const { t } = useTranslation('executions')
  const text = label ?? t('lens.expandSidebar')
  const Icon = side === 'left' ? ChevronRight : ChevronLeft
  return (
    <div
      className={cn(
        'flex w-8 shrink-0 flex-col items-center bg-muted/40 py-2 sm:pointer-coarse:w-12',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
        // Phones: float over the map edge — two in-flow rails cost ~25% width.
        'max-sm:absolute max-sm:top-1/2 max-sm:z-10 max-sm:w-auto max-sm:-translate-y-1/2 max-sm:rounded-md max-sm:border max-sm:border-border max-sm:bg-background/90 max-sm:py-0 max-sm:shadow-sm',
        side === 'left' ? 'max-sm:left-1' : 'max-sm:right-1',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11"
        onClick={onExpand}
        title={text}
        aria-label={text}
        {...buttonAttrs}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </div>
  )
}
