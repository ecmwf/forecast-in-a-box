/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One catalogue list, as a card grid or a table sharing a column template. */

import { createContext, useContext } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type { AdminViewMode } from '@/stores/uiStore'
import { Card } from '@/components/ui/card'
import { useMedia } from '@/hooks/useMedia'
import { cn } from '@/lib/utils'

const GridTemplateContext = createContext('')

interface CatalogueViewProps<T> {
  items: Array<T>
  getKey: (item: T) => string
  viewMode: AdminViewMode
  /** Column template for the header and rows. */
  gridClassName: string
  columns: Array<{ label: string; className?: string }>
  renderCard: (item: T) => ReactNode
  renderRow: (item: T) => ReactNode
  /** No longer matches the filter; tinted. */
  isHeld: (item: T) => boolean
  empty: ReactNode
}

// Flat muted fill replaces the card's brand wash.
const HELD_CARD = '*:data-[slot=card]:bg-none *:data-[slot=card]:bg-muted/60'

export function CatalogueView<T>({
  items,
  getKey,
  viewMode,
  gridClassName,
  columns,
  renderCard,
  renderRow,
  isHeld,
  empty,
}: CatalogueViewProps<T>) {
  const isMobile = useMedia('(max-width: 639px)')

  if (items.length === 0) {
    return <Card className="py-0">{empty}</Card>
  }

  if (isMobile || viewMode === 'card') {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div
            key={getKey(item)}
            data-held={isHeld(item) || undefined}
            className={cn('flex', isHeld(item) && HELD_CARD)}
          >
            {renderCard(item)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <GridTemplateContext.Provider value={gridClassName}>
      <Card className="gap-0 py-0">
        <div
          className={cn(
            'grid items-center gap-4 border-b border-border bg-muted/40 px-5 py-2.5 text-sm font-medium text-muted-foreground',
            gridClassName,
          )}
        >
          {columns.map((c) => (
            <div key={c.label} className={c.className}>
              {c.label}
            </div>
          ))}
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div
              key={getKey(item)}
              data-held={isHeld(item) || undefined}
              className={cn(isHeld(item) && 'bg-muted/60')}
            >
              {renderRow(item)}
            </div>
          ))}
        </div>
      </Card>
    </GridTemplateContext.Provider>
  )
}

/** A table row laid out on the enclosing view's column template. */
export function CatalogueRow({ className, ...props }: ComponentProps<'div'>) {
  const gridClassName = useContext(GridTemplateContext)
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40',
        gridClassName,
        className,
      )}
      {...props}
    />
  )
}
