/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The standalone Configuration Presets page — search, filter and manage saved presets. */

import { useMemo, useState } from 'react'
import { Bookmark, MoreVertical, Pencil, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useConfigPresets } from '../hooks/useConfigPresets'
import type { PresetEntry } from '../hooks/useConfigPresets'
import type {
  FacetKey,
  FacetToken,
  ParsedQuery,
} from '@/features/journal/facets/facet-types'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import { JournalChip } from '@/features/journal/components/JournalChip'
import { RunMetadataDialog } from '@/features/journal/components/RunMetadataDialog'
import { FacetSearchBar } from '@/features/journal/facets/FacetSearchBar'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { applyFacetQuery } from '@/features/journal/facets/apply-facet-query'
import { EmptyState } from '@/components/common/EmptyState'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { H2 } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

/** One preset row — mirrors the Forecast Journal row layout for consistency. */
function PresetRow({
  preset,
  onDelete,
  onToggleFavourite,
  onAddFacet,
}: {
  preset: PresetEntry
  onDelete: (blueprintId: string, version: number) => void
  onToggleFavourite: (blueprintId: string) => void
  /** Clicking a model/output/tag chip adds it to the faceted search. */
  onAddFacet: (token: FacetToken) => void
}) {
  const { t } = useTranslation(['dashboard', 'journal'])
  const showFlow = useUiStore((state) => state.journalShowFlow)
  // Cache-shared with useConfigPresets — a hit, not a new request.
  const { data: blueprint } = useFableRetrieve(preset.blueprintId)
  const [metadataOpen, setMetadataOpen] = useState(false)

  const builder = blueprint?.builder
  const { modelLabel, outputKinds } = preset
  const title = preset.displayName || t('journal:item.untitled')
  const hasChips =
    modelLabel !== null || outputKinds.length > 0 || preset.tags.length > 0

  return (
    <div className="group/row p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Details */}
        <div className="min-w-0 grow">
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <Link
              to="/configure"
              search={{ fableId: preset.blueprintId }}
              className="min-w-0 truncate text-sm font-medium hover:underline"
            >
              {title}
            </Link>
            {/* Reveal on row hover; always shown where hover is unavailable. */}
            <button
              type="button"
              onClick={() => setMetadataOpen(true)}
              aria-label={t('journal:item.editMetadata')}
              className="shrink-0 text-muted-foreground opacity-0 transition-[color,opacity] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-primary [@media(hover:none)]:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {preset.displayDescription && (
            <p className="mb-1 truncate text-sm text-muted-foreground">
              {preset.displayDescription}
            </p>
          )}
          <div className="mb-2 truncate text-sm text-muted-foreground">
            {t('journal:item.outputs', { count: preset.outputCount })}
          </div>
          {hasChips && (
            <div className="flex flex-wrap items-center gap-2">
              {modelLabel && (
                <JournalChip
                  label={modelLabel}
                  variant="facet"
                  onClick={() =>
                    onAddFacet({ key: 'model', value: modelLabel })
                  }
                />
              )}
              {outputKinds.map((kind) => (
                <JournalChip
                  key={kind}
                  label={kind}
                  variant="facet"
                  onClick={() => onAddFacet({ key: 'output', value: kind })}
                />
              ))}
              {preset.tags.map((tag) => (
                <JournalChip
                  key={tag}
                  label={tag}
                  variant="tag"
                  onClick={() => onAddFacet({ key: 'tag', value: tag })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Flow preview — aligned with the row actions. */}
        {showFlow && builder && (
          <FableMiniFlow builder={builder} className="max-w-[18rem] shrink-0" />
        )}

        {/* Actions */}
        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to="/configure" search={{ fableId: preset.blueprintId }} />
            }
            nativeButton={false}
          >
            {t('dashboard:presets.load')}
          </Button>

          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              onClick={() => onToggleFavourite(preset.blueprintId)}
              className={cn(
                'transition-colors hover:text-yellow-500',
                preset.isFavourite && 'text-yellow-500',
              )}
              aria-label={t('dashboard:presets.bookmark')}
            >
              <Star
                className={cn(
                  'h-5 w-5',
                  preset.isFavourite && 'fill-yellow-500',
                )}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="transition-colors hover:text-primary"
                    aria-label={t('journal:item.moreOptions')}
                  />
                }
              >
                <MoreVertical className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(preset.blueprintId, preset.version)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('dashboard:presets.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <RunMetadataDialog
        blueprint={blueprint}
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
      />
    </div>
  )
}

const PAGE_SIZE = 10

type PresetFilter = 'all' | 'bookmarked'

/** Case-insensitive substring test of a preset against one facet token. */
function matchesPresetFacet(
  preset: PresetEntry,
  key: FacetKey,
  value: string,
): boolean {
  const needle = value.toLowerCase()
  if (key === 'model') {
    return (preset.modelLabel ?? '').toLowerCase().includes(needle)
  }
  if (key === 'output') {
    return preset.outputKinds.some((kind) =>
      kind.toLowerCase().includes(needle),
    )
  }
  return preset.tags.some((tag) => tag.toLowerCase().includes(needle))
}

/** Apply the All/Bookmarked tab plus a faceted search query to the preset list. */
function filterPresets(
  presets: ReadonlyArray<PresetEntry>,
  filter: PresetFilter,
  query: ParsedQuery,
): Array<PresetEntry> {
  const byTab = presets.filter((preset) =>
    filter === 'bookmarked' ? preset.isFavourite : true,
  )

  return applyFacetQuery(byTab, query, {
    supportedKeys: ['model', 'output', 'tag'],
    matchFacet: matchesPresetFacet,
    matchText: (preset, text) =>
      (preset.displayName ?? '').toLowerCase().includes(text) ||
      (preset.displayDescription ?? '').toLowerCase().includes(text) ||
      preset.blueprintId.toLowerCase().includes(text) ||
      (preset.modelLabel?.toLowerCase().includes(text) ?? false) ||
      preset.tags.some((tag) => tag.toLowerCase().includes(text)),
  })
}

export function PresetsPage() {
  const { t } = useTranslation(['dashboard', 'journal'])
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const showFlow = useUiStore((state) => state.journalShowFlow)
  const setShowFlow = useUiStore((state) => state.setJournalShowFlow)
  const monochrome = useUiStore((state) => state.journalFlowMonochrome)
  const setMonochrome = useUiStore((state) => state.setJournalFlowMonochrome)

  const { presets, deletePreset, toggleFavourite } = useConfigPresets()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PresetFilter>('all')
  const [page, setPage] = useState(1)

  const filteredPresets = useMemo(
    () => filterPresets(presets, filter, parseQuery(query)),
    [presets, filter, query],
  )

  const totalPages = Math.max(1, Math.ceil(filteredPresets.length / PAGE_SIZE))
  const paginatedPresets = filteredPresets.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  )

  return (
    <ListPageContainer>
      <PageHeader
        title={t('presets.page.title')}
        description={t('presets.page.description')}
      />

      <Card
        className="overflow-hidden"
        variant={dashboardVariant}
        shadow={panelShadow}
      >
        {/* Header bar */}
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
          {/* Title + flow-preview toggles */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
            <H2 className="text-xl font-semibold">{t('presets.page.title')}</H2>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>{t('journal:flowToggle')}</span>
              <Switch
                checked={showFlow}
                onCheckedChange={setShowFlow}
                aria-label={t('journal:flowToggle')}
              />
            </div>
            {/* Temporary: monochrome mini-flow toggle (to be removed). */}
            {showFlow && (
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>{t('journal:flowMonochrome')}</span>
                <Switch
                  checked={monochrome}
                  onCheckedChange={setMonochrome}
                  aria-label={t('journal:flowMonochrome')}
                />
              </div>
            )}
          </div>

          {/* Faceted search — shared with the Forecast Journal — plus tabs. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:justify-end">
            <FacetSearchBar
              value={query}
              onChange={(value) => {
                setQuery(value)
                setPage(1)
              }}
            />

            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              {(['all', 'bookmarked'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFilter(f)
                    setPage(1)
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    filter === f
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  {t(`presets.filters.${f}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="divide-y divide-border">
          {paginatedPresets.length > 0 ? (
            paginatedPresets.map((preset) => (
              <PresetRow
                key={preset.blueprintId}
                preset={preset}
                onDelete={deletePreset}
                onToggleFavourite={toggleFavourite}
                onAddFacet={(token) => {
                  setQuery((current) => addToken(current, token))
                  setPage(1)
                }}
              />
            ))
          ) : query || filter !== 'all' ? (
            <EmptyState icon={Bookmark} title={t('presets.empty.filtered')} />
          ) : (
            <EmptyState
              icon={Bookmark}
              title={t('presets.empty.title')}
              description={t('presets.empty.description')}
            />
          )}
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </Card>
    </ListPageContainer>
  )
}
