/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One plugin catalogue; status is a filter, so items never move. */

import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertCircle, Puzzle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PluginBadgeKind,
  PluginCapability,
  PluginCompositeId,
  PluginInfo,
} from '@/api/types/plugins.types'
import type { SortOption } from '@/components/common/catalogue/useStableOrder'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import {
  useDisablePlugin,
  useEnablePlugin,
  useInstallPlugin,
  usePluginOperations,
  usePlugins,
  useRefreshPlugins,
  useUninstallPlugin,
  useUpdatePlugin,
} from '@/api/hooks/usePlugins'
import { useStatus } from '@/api/hooks/useStatus'
import { encodePluginId, pluginBadgeKind } from '@/api/types/plugins.types'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CatalogueToolbar } from '@/components/common/catalogue/CatalogueToolbar'
import { CatalogueView } from '@/components/common/catalogue/CatalogueView'
import { useHeldKeys } from '@/components/common/catalogue/useHeldKeys'
import {
  resolveCatalogueSort,
  useStableOrder,
} from '@/components/common/catalogue/useStableOrder'
import { PluginCard } from '@/features/plugins/components/PluginCard'
import { PluginRow } from '@/features/plugins/components/PluginRow'
import { pluginFailureDescription } from '@/features/plugins/utils/plugin-activity'
import { useActivityStore } from '@/stores/activityStore'
import { useUiStore } from '@/stores/uiStore'
import { getPluginStatusError } from '@/types/status.types'

export const Route = createFileRoute('/_authenticated/admin/plugins/')({
  component: PluginsPage,
})

type PluginFilter = 'all' | 'installed' | 'updates' | 'available'
type CapabilityFilter = 'all' | PluginCapability

const CAPABILITIES: Array<PluginCapability> = [
  'source',
  'transform',
  'product',
  'sink',
]

const GRID =
  'sm:grid-cols-[minmax(0,1fr)_9rem_15rem] lg:grid-cols-[minmax(0,1fr)_8rem_9rem_15rem] xl:grid-cols-[minmax(0,1fr)_8rem_9rem_19rem]'

const pluginKey = (p: PluginInfo) => `${p.id.store}/${p.id.local}`

function matchesFilter(plugin: PluginInfo, filter: PluginFilter) {
  switch (filter) {
    case 'all':
      return true
    case 'installed':
      return plugin.isInstalled
    case 'updates':
      return plugin.hasUpdate
    case 'available':
      return !plugin.isInstalled
  }
}

const byName = (a: PluginInfo, b: PluginInfo) => a.name.localeCompare(b.name)

// Needs attention first when sorting by status.
const STATUS_RANK: Record<PluginBadgeKind, number> = {
  errored: 0,
  warning: 1,
  update: 2,
  loaded: 3,
  disabled: 4,
  available: 5,
}

const updatedTime = (p: PluginInfo) =>
  p.updatedAt ? new Date(p.updatedAt).getTime() : 0

function PluginsPage() {
  const { t } = useTranslation(['plugins', 'common'])
  const navigate = useNavigate()
  const viewMode = useUiStore((state) => state.pluginsViewMode)
  const setViewMode = useUiStore((state) => state.setPluginsViewMode)
  const storedSort = useUiStore((state) => state.pluginsSort)
  const setStoredSort = useUiStore((state) => state.setPluginsSort)

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>('all')

  const { status: systemStatus } = useStatus()
  const pluginStatusError = systemStatus
    ? getPluginStatusError(systemStatus.plugins)
    : null

  const { data: catalogue } = useBlockCatalogue()
  const { plugins, isLoading } = usePlugins(catalogue)

  const installPlugin = useInstallPlugin()
  const uninstallPlugin = useUninstallPlugin()
  const enablePlugin = useEnablePlugin()
  const disablePlugin = useDisablePlugin()
  const updatePlugin = useUpdatePlugin()
  const refreshPlugins = useRefreshPlugins()
  const operations = usePluginOperations()

  const searched = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return plugins
      .filter(
        (p) =>
          capabilityFilter === 'all' ||
          p.capabilities.includes(capabilityFilter),
      )
      .filter(
        (p) =>
          !query ||
          p.name.toLowerCase().includes(query) ||
          p.displayId.toLowerCase().includes(query) ||
          p.author.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query),
      )
  }, [plugins, searchQuery, capabilityFilter])

  const sortOptions: Array<SortOption<PluginInfo>> = [
    { key: 'name', label: t('table.headers.plugin'), compare: byName },
    {
      key: 'updated',
      label: t('table.headers.updated'),
      compare: (a, b) => updatedTime(a) - updatedTime(b),
      defaultDir: 'desc',
    },
    {
      key: 'status',
      label: t('table.headers.status'),
      compare: (a, b) =>
        STATUS_RANK[pluginBadgeKind(a)] - STATUS_RANK[pluginBadgeKind(b)],
    },
  ]
  const sorting = resolveCatalogueSort(
    sortOptions,
    storedSort,
    setStoredSort,
    byName,
  )

  // Only user actions re-sort or release held items.
  const viewKey = `${filter}|${capabilityFilter}|${searchQuery}|${sorting.sort.key}|${sorting.sort.dir}`
  const held = useHeldKeys([...operations.keys()], viewKey)
  const visible = useStableOrder(
    searched.filter((p) => matchesFilter(p, filter) || held.has(pluginKey(p))),
    pluginKey,
    sorting.compare,
    viewKey,
  )
  const count = (f: PluginFilter) =>
    searched.filter((p) => matchesFilter(p, f)).length

  const addActivity = useActivityStore((state) => state.addTask)

  function trackPluginOp(
    compositeId: PluginCompositeId,
    labels: { active: string; success: string; failure: string },
    mutation: { mutateAsync: (id: PluginCompositeId) => Promise<void> },
  ) {
    const id = `plugin:${compositeId.store}/${compositeId.local}:${labels.active}`
    const name =
      plugins.find(
        (p) =>
          p.id.store === compositeId.store && p.id.local === compositeId.local,
      )?.name ?? `${compositeId.store}/${compositeId.local}`
    addActivity({
      id,
      type: 'plugin',
      label: name,
      description: `${labels.active}…`,
      status: 'active',
      startedAt: Date.now(),
      navigateTo: `/admin/plugins/${encodePluginId(compositeId)}`,
    })
    mutation.mutateAsync(compositeId).then(
      () => {
        useActivityStore.getState().updateTask(id, {
          status: 'completed',
          description: labels.success,
          completedAt: Date.now(),
        })
      },
      (error: unknown) => {
        useActivityStore.getState().updateTask(id, {
          status: 'failed',
          description: pluginFailureDescription(error, labels.failure),
          completedAt: Date.now(),
        })
      },
    )
  }

  const handlers = {
    onToggle: (compositeId: PluginCompositeId, enabled: boolean) =>
      (enabled ? enablePlugin : disablePlugin).mutate(compositeId),
    onInstall: (compositeId: PluginCompositeId) =>
      trackPluginOp(
        compositeId,
        {
          active: t('activity.installing'),
          success: t('activity.installed'),
          failure: t('activity.installFailed'),
        },
        installPlugin,
      ),
    onUninstall: (compositeId: PluginCompositeId) =>
      trackPluginOp(
        compositeId,
        {
          active: t('activity.uninstalling'),
          success: t('activity.uninstalled'),
          failure: t('activity.uninstallFailed'),
        },
        uninstallPlugin,
      ),
    onUpdate: (compositeId: PluginCompositeId) =>
      trackPluginOp(
        compositeId,
        {
          active: t('activity.updating'),
          success: t('activity.updated'),
          failure: t('activity.updateFailed'),
        },
        updatePlugin,
      ),
    onViewDetails: (plugin: PluginInfo) =>
      navigate({
        to: '/admin/plugins/$pluginId',
        params: { pluginId: encodePluginId(plugin.id) },
      }),
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const capabilityItems = [
    { value: 'all', label: t('filters.capability.all') },
    ...CAPABILITIES.map((c) => ({
      value: c,
      label: t(`filters.capability.${c}`),
    })),
  ]

  const isFiltered =
    filter !== 'all' || capabilityFilter !== 'all' || searchQuery.trim() !== ''

  return (
    <ListPageContainer>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button
            variant="outline"
            onClick={() => refreshPlugins.mutate()}
            disabled={refreshPlugins.isPending}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshPlugins.isPending ? 'animate-spin' : ''}`}
            />
            {t('actions.checkUpdates')}
          </Button>
        }
      />

      {pluginStatusError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('status.error')}</AlertTitle>
          <AlertDescription>{pluginStatusError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <CatalogueToolbar
          segments={[
            { value: 'all', label: t('filters.all'), count: count('all') },
            {
              value: 'installed',
              label: t('filters.installed'),
              count: count('installed'),
            },
            {
              value: 'updates',
              label: t('filters.updates'),
              count: count('updates'),
              attention: true,
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
        >
          <Select
            value={capabilityFilter}
            onValueChange={(value) =>
              setCapabilityFilter(value as CapabilityFilter)
            }
            items={capabilityItems}
          >
            <SelectTrigger
              className="min-w-40"
              aria-label={t('filters.capabilityLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capabilityItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CatalogueToolbar>

        <CatalogueView
          items={visible}
          getKey={pluginKey}
          viewMode={viewMode}
          gridClassName={GRID}
          sort={sorting.sort}
          onSortChange={sorting.onSortChange}
          columns={[
            { label: t('table.headers.plugin'), sortKey: 'name' },
            {
              label: t('table.headers.updated'),
              className: 'hidden lg:block',
              sortKey: 'updated',
            },
            { label: t('table.headers.status'), sortKey: 'status' },
            { label: t('table.headers.actions'), className: 'text-right' },
          ]}
          isHeld={(p) => !matchesFilter(p, filter)}
          renderCard={(plugin) => (
            <PluginCard
              plugin={plugin}
              operation={operations.get(pluginKey(plugin))}
              {...handlers}
            />
          )}
          renderRow={(plugin) => (
            <PluginRow
              plugin={plugin}
              operation={operations.get(pluginKey(plugin))}
              {...handlers}
            />
          )}
          empty={
            isFiltered ? (
              <EmptyState
                icon={Puzzle}
                title={t('common:catalogue.noMatches')}
                description={t('common:catalogue.noMatchesHint')}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilter('all')
                      setCapabilityFilter('all')
                      setSearchQuery('')
                    }}
                  >
                    {t('common:catalogue.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Puzzle}
                title={t('emptyState.noPlugins')}
                description={t('emptyState.noPluginsDescription')}
              />
            )
          }
        />
      </div>
    </ListPageContainer>
  )
}
