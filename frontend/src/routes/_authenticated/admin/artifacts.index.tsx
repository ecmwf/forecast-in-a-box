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
 * Artifacts List Page Route
 *
 * Browse and manage ML model artifacts.
 * Follows the plugins page pattern: downloaded models in a table,
 * available models in a card grid below.
 */

import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { encodeArtifactId } from '@/api/types/artifacts.types'
import {
  useArtifacts,
  useDeleteModel,
  useDownloadModel,
} from '@/api/hooks/useArtifacts'
import { H3 } from '@/components/base/typography'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  ArtifactsFilters,
  ArtifactsList,
  ArtifactsPageHeader,
  AvailableModelsSection,
} from '@/features/artifacts'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

export const Route = createFileRoute('/_authenticated/admin/artifacts/')({
  component: ArtifactsPage,
})

function ArtifactsPage() {
  const { t } = useTranslation('artifacts')
  const navigate = useNavigate()
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const artifactsViewMode = useUiStore((state) => state.artifactsViewMode)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')

  // Queries & mutations
  const { artifacts, isLoading, refetch } = useArtifacts()
  const downloadModel = useDownloadModel()
  const deleteModel = useDeleteModel()

  // Separate artifacts into downloaded and available
  const { downloadedArtifacts, availableArtifacts } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = (a: ArtifactInfo) =>
      !query ||
      a.displayName.toLowerCase().includes(query) ||
      a.author.toLowerCase().includes(query)

    const downloaded = artifacts
      .filter((a) => a.isAvailable)
      .filter(matchesSearch)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    const available = artifacts
      .filter((a) => !a.isAvailable)
      .filter(matchesSearch)

    return {
      downloadedArtifacts: downloaded,
      availableArtifacts: available,
    }
  }, [artifacts, searchQuery])

  // Handlers
  const handleViewDetails = (artifact: ArtifactInfo) => {
    navigate({
      to: '/admin/artifacts/$artifactId',
      params: { artifactId: encodeArtifactId(artifact.id) },
    })
  }

  const handleRefresh = () => {
    refetch()
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      {/* Page Header */}
      <ArtifactsPageHeader onRefresh={handleRefresh} />

      {/* Search & View Mode */}
      <ArtifactsFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Downloaded Models Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {t('downloadedSection.title')}
          </H3>
          <span className="font-mono text-sm text-muted-foreground">
            {t('downloadedSection.total', {
              count: downloadedArtifacts.length,
            })}
          </span>
        </div>

        <ArtifactsList
          artifacts={downloadedArtifacts}
          viewMode={artifactsViewMode}
          onDelete={(id) => deleteModel.mutate(id)}
          onViewDetails={handleViewDetails}
          deletingId={deleteModel.isPending ? deleteModel.variables : undefined}
          variant={dashboardVariant}
          shadow={panelShadow}
        />
      </div>

      {/* Available Models Section */}
      <AvailableModelsSection
        artifacts={availableArtifacts}
        onDownload={downloadModel.mutate}
        onCancelDownload={downloadModel.cancel}
        onViewDetails={handleViewDetails}
        isDownloading={downloadModel.isDownloading}
        getDownloadProgress={downloadModel.getProgress}
        variant={dashboardVariant}
        shadow={panelShadow}
      />
    </div>
  )
}
