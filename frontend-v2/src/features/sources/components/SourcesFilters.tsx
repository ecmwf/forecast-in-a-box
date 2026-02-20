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
 * SourcesFilters Component
 *
 * Filter controls for the sources list
 */

import { LayoutGrid, List, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceType } from '@/api/types/sources.types'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type SourceTypeFilter = 'all' | SourceType
export type SourceStatusFilter = 'all' | 'ready' | 'available'

interface SourcesFiltersProps {
  typeFilter: SourceTypeFilter
  onTypeChange: (type: SourceTypeFilter) => void
  statusFilter: SourceStatusFilter
  onStatusChange: (status: SourceStatusFilter) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  viewMode: AdminViewMode
  onViewModeChange: (mode: AdminViewMode) => void
  pluginFilter?: string
  onPluginChange?: (pluginId: string) => void
  availablePlugins?: Array<{ id: string; name: string }>
}

export function SourcesFilters({
  typeFilter,
  onTypeChange,
  statusFilter,
  onStatusChange,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  pluginFilter,
  onPluginChange,
  availablePlugins = [],
}: SourcesFiltersProps) {
  const { t } = useTranslation('sources')

  return (
    <div className="flex flex-col gap-4">
      {/* Main Filter Row */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        {/* Type Filter Tabs */}
        <ToggleGroup
          value={[typeFilter]}
          onValueChange={(value) => {
            if (value.length > 0) {
              onTypeChange(value[0] as SourceTypeFilter)
            }
          }}
          variant="outline"
          className="self-start *:data-[slot=toggle-group-item]:px-4! lg:self-auto"
        >
          <ToggleGroupItem value="all">{t('filters.all')}</ToggleGroupItem>
          <ToggleGroupItem value="model">{t('filters.models')}</ToggleGroupItem>
          <ToggleGroupItem value="dataset">
            {t('filters.datasets')}
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Search and Additional Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {/* Search Input - full width on mobile */}
          <div className="relative w-full sm:min-w-0 sm:flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-10"
              placeholder={t('filters.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {/* Filters row - wraps on mobile */}
          <div className="flex flex-wrap gap-3">
            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                onStatusChange(value as SourceStatusFilter)
              }
            >
              <SelectTrigger className="w-30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.all')}</SelectItem>
                <SelectItem value="ready">{t('filters.ready')}</SelectItem>
                <SelectItem value="available">
                  {t('filters.available')}
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Plugin Filter (optional) */}
            {availablePlugins.length > 0 && onPluginChange && (
              <Select
                value={pluginFilter ?? 'all'}
                onValueChange={(value) => {
                  if (value !== null) {
                    onPluginChange(value)
                  }
                }}
              >
                <SelectTrigger className="w-35">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.all')}</SelectItem>
                  {availablePlugins.map((plugin) => (
                    <SelectItem key={plugin.id} value={plugin.id}>
                      {plugin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* View Mode Toggle - hidden on mobile where only card view works */}
            <div className="hidden items-center rounded-md border sm:flex">
              <Button
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-9 w-9 rounded-r-none"
                onClick={() => onViewModeChange('table')}
                aria-label="Table view"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'card' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-9 w-9 rounded-l-none border-l"
                onClick={() => onViewModeChange('card')}
                aria-label="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
