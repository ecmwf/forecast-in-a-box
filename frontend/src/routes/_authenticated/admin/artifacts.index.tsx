/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One model catalogue; status is a filter, so items never move. */

import { useMemo, useState } from 'react'
import { Package, RefreshCw } from 'lucide-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import type { DeleteArtifactTarget } from '@/features/artifacts/components/ConfirmDeleteArtifactDialog'
import { encodeArtifactId } from '@/api/types/artifacts.types'
import {
  useArtifacts,
  useDeleteModel,
  useDeletingKeys,
  useDownloadActions,
  useDownloadingKeys,
} from '@/api/hooks/useArtifacts'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { CatalogueToolbar } from '@/components/common/catalogue/CatalogueToolbar'
import { CatalogueView } from '@/components/common/catalogue/CatalogueView'
import { useHeldKeys } from '@/components/common/catalogue/useHeldKeys'
import { ArtifactCard } from '@/features/artifacts/components/ArtifactCard'
import { ArtifactRow } from '@/features/artifacts/components/ArtifactRow'
import { ConfirmDeleteArtifactDialog } from '@/features/artifacts/components/ConfirmDeleteArtifactDialog'
import { useUiStore } from '@/stores/uiStore'

export const Route = createFileRoute('/_authenticated/admin/artifacts/')({
  component: ArtifactsPage,
})

type ArtifactFilter = 'all' | 'downloaded' | 'available'

const GRID =
  'sm:grid-cols-[minmax(0,1fr)_9rem_15rem] lg:grid-cols-[minmax(0,1fr)_6rem_9rem_16rem]'

function matchesFilter(artifact: ArtifactInfo, filter: ArtifactFilter) {
  if (filter === 'all') return true
  return artifact.isAvailable === (filter === 'downloaded')
}

function ArtifactsPage() {
  const { t } = useTranslation(['artifacts', 'common'])
  const navigate = useNavigate()
  const viewMode = useUiStore((state) => state.artifactsViewMode)
  const setViewMode = useUiStore((state) => state.setArtifactsViewMode)

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<ArtifactFilter>('all')
  const [pendingDelete, setPendingDelete] =
    useState<DeleteArtifactTarget | null>(null)

  const { artifacts, isLoading, refetch } = useArtifacts()
  const { mutate: download, cancel: cancelDownload } = useDownloadActions()
  const deleteModel = useDeleteModel()
  const downloadingKeys = useDownloadingKeys()
  const deletingKeys = useDeletingKeys()

  const searched = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return artifacts
      .filter(
        (a) =>
          !query ||
          a.displayName.toLowerCase().includes(query) ||
          a.author.toLowerCase().includes(query),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [artifacts, searchQuery])

  const held = useHeldKeys(
    [...downloadingKeys, ...deletingKeys],
    `${filter}|${searchQuery}`,
  )
  const visible = searched.filter(
    (a) => matchesFilter(a, filter) || held.has(a.encodedId),
  )
  const count = (f: ArtifactFilter) =>
    searched.filter((a) => matchesFilter(a, f)).length

  const handlers = {
    onDownload: download,
    onCancelDownload: cancelDownload,
    onDelete: (id: ArtifactInfo['id']) => {
      const artifact = artifacts.find(
        (a) => a.encodedId === encodeArtifactId(id),
      )
      setPendingDelete({ id, name: artifact?.displayName ?? '' })
    },
    onViewDetails: (artifact: ArtifactInfo) =>
      navigate({
        to: '/admin/artifacts/$artifactId',
        params: { artifactId: artifact.encodedId },
      }),
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const isFiltered = filter !== 'all' || searchQuery.trim() !== ''

  return (
    <ListPageContainer>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('actions.refresh')}
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <CatalogueToolbar
          segments={[
            { value: 'all', label: t('filters.all'), count: count('all') },
            {
              value: 'downloaded',
              label: t('filters.downloaded'),
              count: count('downloaded'),
            },
            {
              value: 'available',
              label: t('filters.available'),
              count: count('available'),
            },
          ]}
          segment={filter}
          onSegmentChange={setFilter}
          segmentsLabel={t('filters.statusLabel')}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t('filters.searchPlaceholder')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        <CatalogueView
          items={visible}
          getKey={(a) => a.encodedId}
          viewMode={viewMode}
          gridClassName={GRID}
          columns={[
            { label: t('table.model') },
            { label: t('table.size'), className: 'hidden lg:block' },
            { label: t('table.status') },
            { label: t('table.actions'), className: 'text-right' },
          ]}
          isHeld={(a) => !matchesFilter(a, filter)}
          renderCard={(artifact) => (
            <ArtifactCard
              artifact={artifact}
              isDeleting={deletingKeys.includes(artifact.encodedId)}
              {...handlers}
            />
          )}
          renderRow={(artifact) => (
            <ArtifactRow
              artifact={artifact}
              isDeleting={deletingKeys.includes(artifact.encodedId)}
              {...handlers}
            />
          )}
          empty={
            isFiltered ? (
              <EmptyState
                icon={Package}
                title={t('common:catalogue.noMatches')}
                description={t('common:catalogue.noMatchesHint')}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilter('all')
                      setSearchQuery('')
                    }}
                  >
                    {t('common:catalogue.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Package}
                title={t('emptyState.noModels')}
                description={t('emptyState.noModelsDescription')}
              />
            )
          }
        />
      </div>

      <ConfirmDeleteArtifactDialog
        target={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => {
          setPendingDelete(null)
          deleteModel.mutate(id)
        }}
      />
    </ListPageContainer>
  )
}
