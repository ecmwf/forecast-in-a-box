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
 * AvailableModelsSection Component
 *
 * Displays ML models that are not yet downloaded, available for download.
 * Follows the UninstalledPluginsSection pattern.
 */

import { useState } from 'react'
import { Package, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArtifactCard } from './ArtifactCard'
import type {
  ArtifactInfo,
  CompositeArtifactId,
} from '@/api/types/artifacts.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Input } from '@/components/ui/input'

interface AvailableModelsSectionProps {
  artifacts: Array<ArtifactInfo>
  onDownload: (compositeId: CompositeArtifactId) => void
  onCancelDownload?: (compositeId: CompositeArtifactId) => void
  onViewDetails?: (artifact: ArtifactInfo) => void
  isDownloading: (compositeId: CompositeArtifactId) => boolean
  getDownloadProgress: (compositeId: CompositeArtifactId) => number | undefined
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function AvailableModelsSection({
  artifacts,
  onDownload,
  onCancelDownload,
  onViewDetails,
  isDownloading,
  getDownloadProgress,
  variant,
  shadow,
}: AvailableModelsSectionProps) {
  const { t } = useTranslation('artifacts')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter by search query
  const filteredArtifacts = artifacts.filter((artifact) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      artifact.displayName.toLowerCase().includes(query) ||
      artifact.author.toLowerCase().includes(query)
    )
  })

  // Sort alphabetically by name
  const sortedArtifacts = [...filteredArtifacts].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {t('availableSection.title')}
          </H3>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="mb-4 h-16 w-16 text-muted-foreground/50" />
          <H3 className="mb-2 text-lg font-semibold">
            {t('emptyState.noModels')}
          </H3>
          <P className="max-w-md text-muted-foreground">
            {t('emptyState.noModelsDescription')}
          </P>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 px-1">
          <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {t('availableSection.title')}
          </H3>
          <span className="font-mono text-sm text-muted-foreground">
            {t('availableSection.total', { count: artifacts.length })}
          </span>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('availableSection.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Description */}
      <P className="px-1 text-muted-foreground">
        {t('availableSection.description')}
      </P>

      {/* Model Cards */}
      {sortedArtifacts.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {sortedArtifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.encodedId}
              artifact={artifact}
              onDownload={onDownload}
              onDelete={() => {}}
              onCancelDownload={onCancelDownload}
              onViewDetails={onViewDetails}
              isDownloading={isDownloading(artifact.id)}
              downloadProgress={getDownloadProgress(artifact.id)}
              variant={variant}
              shadow={shadow}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <P className="text-muted-foreground">{t('emptyState.title')}</P>
        </div>
      )}
    </div>
  )
}
