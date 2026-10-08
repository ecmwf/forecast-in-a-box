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
import type { SortOption } from '@/components/common/catalogue/useStableOrder'
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
import {
  resolveCatalogueSort,
  useStableOrder,
} from '@/components/common/catalogue/useStableOrder'
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

const byName = (a: ArtifactInfo, b: ArtifactInfo) =>
  a.displayName.localeCompare(b.displayName)

function ArtifactsPage() {
  const { t } = useTranslation(['artifacts', 'common'])
  const navigate = useNavigate()
  const viewMode = useUiStore((state) => state.artifactsViewMode)
  const setViewMode = useUiStore((state) => state.setArtifactsViewMode)
  const storedSort = useUiStore((state) => state.artifactsSort)
  const setStoredSort = useUiStore((state) => state.setArtifactsSort)

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<ArtifactFilter>('all')
  const [pendingDelete, setPendingDelete] =
    useState<DeleteArtifactTarget | null>(null)

  const { artifacts, isLoading, refetch } = useArtifacts()
  const { mutate: download } = useDownloadActions()
  const deleteModel = useDeleteModel()
  const downloadingKeys = useDownloadingKeys()
  const deletingKeys = useDeletingKeys()

  const searched = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return artifacts.filter(
      (a) =>
        !query ||
        a.displayName.toLowerCase().includes(query) ||
        a.author.toLowerCase().includes(query),
    )
  }, [artifacts, searchQuery])

  const sortOptions: Array<SortOption<ArtifactInfo>> = [
    { key: 'name', label: t('table.model'), compare: byName },
    {
      key: 'size',
      label: t('table.size'),
      compare: (a, b) => a.diskSizeBytes - b.diskSizeBytes,
      defaultDir: 'desc',
    },
    {
      key: 'status',
      label: t('table.status'),
      compare: (a, b) => Number(b.isAvailable) - Number(a.isAvailable),
    },
  ]
  const sorting = resolveCatalogueSort(
    sortOptions,
    storedSort,
    setStoredSort,
    byName,
  )

  // Only user actions re-sort or release held items.
  const viewKey = `${filter}|${searchQuery}|${sorting.sort.key}|${sorting.sort.dir}`
  const held = useHeldKeys([...downloadingKeys, ...deletingKeys], viewKey)
  const visible = useStableOrder(
    searched.filter((a) => matchesFilter(a, filter) || held.has(a.encodedId)),
    (a) => a.encodedId,
    sorting.compare,
    viewKey,
  )
  const count = (f: ArtifactFilter) =>
    searched.filter((a) => matchesFilter(a, f)).length

  const handlers = {
    onDownload: download,
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
          sortOptions={sortOptions}
          sort={sorting.sort}
          onSortChange={sorting.onSortSelect}
          onSortDirToggle={sorting.onSortDirToggle}
        />

        <CatalogueView
          items={visible}
          getKey={(a) => a.encodedId}
          viewMode={viewMode}
          gridClassName={GRID}
          sort={sorting.sort}
          onSortChange={sorting.onSortChange}
          columns={[
            { label: t('table.model'), sortKey: 'name' },
            {
              label: t('table.size'),
              className: 'hidden lg:block',
              sortKey: 'size',
            },
            { label: t('table.status'), sortKey: 'status' },
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
