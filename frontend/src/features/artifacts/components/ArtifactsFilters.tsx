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
 * ArtifactsFilters Component
 *
 * Search and filter controls for artifacts.
 * Follows the PluginsFilters pattern with view mode toggle.
 */

import { LayoutGrid, List, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUiStore } from '@/stores/uiStore'

interface ArtifactsFiltersProps {
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function ArtifactsFilters({
  searchQuery,
  onSearchChange,
}: ArtifactsFiltersProps) {
  const { t } = useTranslation('artifacts')
  const viewMode = useUiStore((state) => state.artifactsViewMode)
  const setViewMode = useUiStore((state) => state.setArtifactsViewMode)

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
  )
}
