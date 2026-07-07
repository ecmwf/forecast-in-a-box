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
}: {
  side: 'left' | 'right'
  onExpand: () => void
}) {
  const { t } = useTranslation('executions')
  const Icon = side === 'left' ? ChevronRight : ChevronLeft
  return (
    <div
      className={cn(
        'flex w-8 shrink-0 flex-col items-center bg-muted/40 py-2',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onExpand}
        title={t('lens.expandSidebar')}
        aria-label={t('lens.expandSidebar')}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </div>
  )
}
