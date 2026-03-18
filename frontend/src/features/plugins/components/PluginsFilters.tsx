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
 * PluginsFilters Component
 *
 * Search and filter controls for plugins
 */

import { LayoutGrid, List, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PluginCapability, PluginStatus } from '@/api/types/plugins.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUiStore } from '@/stores/uiStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Status filter includes all backend statuses plus 'all' and 'hasUpdate'
 */
export type StatusFilter = 'all' | 'hasUpdate' | PluginStatus

export type CapabilityFilter = 'all' | PluginCapability

interface PluginsFiltersProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (status: StatusFilter) => void
  capabilityFilter: CapabilityFilter
  onCapabilityFilterChange: (capability: CapabilityFilter) => void
}

export function PluginsFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  capabilityFilter,
  onCapabilityFilterChange,
}: PluginsFiltersProps) {
  const { t } = useTranslation('plugins')
  const viewMode = useUiStore((state) => state.pluginsViewMode)
  const setViewMode = useUiStore((state) => state.setPluginsViewMode)

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* Search */}
      <div className="relative flex-1">
        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
          <Search className="h-4 w-4" />
        </span>
        <Input
          type="text"
          placeholder={t('filters.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10"
        />
      </div>

      {/* Filters - allows wrapping on small screens */}
      <div className="flex flex-wrap gap-3">
        {/* Status Filter */}
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.status.all')}</SelectItem>
            <SelectItem value="loaded">{t('filters.status.loaded')}</SelectItem>
            <SelectItem value="disabled">
              {t('filters.status.disabled')}
            </SelectItem>
            <SelectItem value="errored">
              {t('filters.status.errored')}
            </SelectItem>
            <SelectItem value="hasUpdate">
              {t('filters.status.updates')}
            </SelectItem>
            <SelectItem value="available">
              {t('filters.status.available')}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Capability Filter */}
        <Select
          value={capabilityFilter}
          onValueChange={(value) =>
            onCapabilityFilterChange(value as CapabilityFilter)
          }
        >
          <SelectTrigger className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.capability.all')}</SelectItem>
            <SelectItem value="source">
              {t('filters.capability.source')}
            </SelectItem>
            <SelectItem value="transform">
              {t('filters.capability.transform')}
            </SelectItem>
            <SelectItem value="product">
              {t('filters.capability.product')}
            </SelectItem>
            <SelectItem value="sink">{t('filters.capability.sink')}</SelectItem>
          </SelectContent>
        </Select>

        {/* View Mode Toggle - hidden on mobile where only card view works */}
        <div className="hidden items-center rounded-md border sm:flex">
          <Button
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => setViewMode('table')}
            aria-label="Table view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'card' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-l-none border-l"
            onClick={() => setViewMode('card')}
            aria-label="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
