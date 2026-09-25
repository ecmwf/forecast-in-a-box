/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Status segments with counts, search, extra filters and view mode. */

import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
  Search,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { CatalogueSort } from './useStableOrder'
import type { AdminViewMode } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface CatalogueSegment<TValue extends string> {
  value: TValue
  label: string
  count: number
  /** Amber dot while the count is non-zero. */
  attention?: boolean
}

interface CatalogueToolbarProps<TValue extends string> {
  segments: Array<CatalogueSegment<TValue>>
  segment: TValue
  onSegmentChange: (value: TValue) => void
  segmentsLabel: string
  searchQuery: string
  onSearchChange: (query: string) => void
  searchPlaceholder: string
  viewMode: AdminViewMode
  onViewModeChange: (mode: AdminViewMode) => void
  sortOptions: Array<{ key: string; label: string }>
  sort: CatalogueSort
  onSortChange: (key: string) => void
  onSortDirToggle: () => void
  /** Extra filters between search and the view toggle. */
  children?: ReactNode
}

export function CatalogueToolbar<TValue extends string>({
  segments,
  segment,
  onSegmentChange,
  segmentsLabel,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  viewMode,
  onViewModeChange,
  sortOptions,
  sort,
  onSortChange,
  onSortDirToggle,
  children,
}: CatalogueToolbarProps<TValue>) {
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div
        role="radiogroup"
        aria-label={segmentsLabel}
        className="inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {segments.map((s) => {
          const selected = s.value === segment
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSegmentChange(s.value)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                selected
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-muted-foreground tabular-nums',
                  s.count === 0 && 'opacity-60',
                )}
              >
                {s.attention && s.count > 0 && (
                  <span className="size-1.5 rounded-full bg-amber-500" />
                )}
                {s.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9"
          />
        </div>
        {children}
        {/* Cards only: tables sort via their headers. */}
        <div
          className={cn(
            'items-center gap-1',
            viewMode === 'card' ? 'flex' : 'flex sm:hidden',
          )}
        >
          <Select
            value={sort.key}
            onValueChange={(key) => key !== null && onSortChange(key)}
            items={sortOptions.map((o) => ({ value: o.key, label: o.label }))}
          >
            <SelectTrigger
              className="min-w-44"
              aria-label={t('catalogue.sortBy')}
            >
              <span className="text-muted-foreground">
                {t('catalogue.sortBy')}
              </span>
              <SelectValue className="flex-1 text-left" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={onSortDirToggle}
            aria-label={t(
              sort.dir === 'asc'
                ? 'catalogue.sortedAsc'
                : 'catalogue.sortedDesc',
            )}
          >
            {sort.dir === 'asc' ? (
              <ArrowUpNarrowWide className="h-4 w-4" />
            ) : (
              <ArrowDownWideNarrow className="h-4 w-4" />
            )}
          </Button>
        </div>
        {/* Hidden on mobile, where only the card view is used. */}
        <div className="hidden items-center rounded-md border sm:flex">
          <Button
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => onViewModeChange('table')}
            aria-label={t('catalogue.viewTable')}
            aria-pressed={viewMode === 'table'}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'card' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-l-none border-l"
            onClick={() => onViewModeChange('card')}
            aria-label={t('catalogue.viewCard')}
            aria-pressed={viewMode === 'card'}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
