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
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComponentProps, ReactNode } from 'react'
import type { CatalogueSort } from './useStableOrder'
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
  columns: Array<{ label: string; className?: string; sortKey?: string }>
  sort: CatalogueSort
  onSortChange: (key: string) => void
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
  sort,
  onSortChange,
  renderCard,
  renderRow,
  isHeld,
  empty,
}: CatalogueViewProps<T>) {
  const { t } = useTranslation('common')
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
          {columns.map((c) => {
            const sortKey = c.sortKey
            if (!sortKey) {
              return (
                <div key={c.label} className={c.className}>
                  {c.label}
                </div>
              )
            }
            const active = sort.key === sortKey
            const Icon = !active
              ? ChevronsUpDown
              : sort.dir === 'asc'
                ? ArrowUp
                : ArrowDown
            return (
              <div key={c.label} className={c.className}>
                <button
                  type="button"
                  onClick={() => onSortChange(sortKey)}
                  className={cn(
                    'group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    active && 'text-foreground',
                  )}
                >
                  {c.label}
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5',
                      !active &&
                        'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60',
                    )}
                  />
                  {active && (
                    <span className="sr-only">
                      {t(
                        sort.dir === 'asc'
                          ? 'catalogue.sortedAsc'
                          : 'catalogue.sortedDesc',
                      )}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
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
