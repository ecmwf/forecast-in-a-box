/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pencil,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useConfigPresets } from '../hooks/useConfigPresets'
import type { PresetEntry } from '../hooks/useConfigPresets'
import { useFableRetrieve, useUpsertFable } from '@/api/hooks/useFable'
import { PageHeader } from '@/components/common/PageHeader'
import { H2, P } from '@/components/base/typography'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

function RenamePopover({
  blueprintId,
  currentTitle,
  currentComments,
}: {
  blueprintId: string
  currentTitle: string
  currentComments: string
}) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(currentTitle)
  const [comments, setComments] = useState(currentComments)
  const upsertFable = useUpsertFable()
  const { data: fableData } = useFableRetrieve(blueprintId)

  function handleOpen(nextOpen: boolean) {
    if (nextOpen) {
      setTitle(currentTitle)
      setComments(currentComments)
    }
    setOpen(nextOpen)
  }

  function handleSave() {
    const trimmed = title.trim()
    if (!trimmed || !fableData) return
    upsertFable.mutate({
      fable: fableData.builder,
      fableId: blueprintId,
      fableVersion: fableData.version,
      display_name: trimmed,
      display_description: comments.trim(),
      tags: fableData.tags,
    })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger
        render={
          <button
            className="text-muted-foreground transition-colors hover:text-primary"
            aria-label={t('presets.rename')}
          />
        }
      >
        <Pencil className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{t('presets.renameTitle')}</PopoverTitle>
          <P className="text-sm text-muted-foreground">
            {t('presets.renameDescription')}
          </P>
        </PopoverHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rename-title-${blueprintId}`}>Title</Label>
          <Input
            id={`rename-title-${blueprintId}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rename-comments-${blueprintId}`}>Comments</Label>
          <textarea
            id={`rename-comments-${blueprintId}`}
            rows={2}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PresetRow({
  preset,
  onDelete,
  onToggleFavourite,
}: {
  preset: PresetEntry
  onDelete: (blueprintId: string, version: number) => void
  onToggleFavourite: (blueprintId: string) => void
}) {
  const { t } = useTranslation('dashboard')

  const title = preset.displayName || preset.blueprintId.slice(0, 8)
  const comments = preset.displayDescription || ''
  const tags = preset.tags

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Content */}
        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <P className="truncate font-medium">{title}</P>
            <RenamePopover
              blueprintId={preset.blueprintId}
              currentTitle={title}
              currentComments={comments}
            />
          </div>
          {comments && (
            <P className="mb-2 line-clamp-1 text-sm text-muted-foreground">
              {comments}
            </P>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-sm"
            render={
              <Link to="/configure" search={{ fableId: preset.blueprintId }} />
            }
            nativeButton={false}
          >
            {t('presets.load')}
          </Button>

          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              onClick={() => onToggleFavourite(preset.blueprintId)}
              className={cn(
                'transition-colors hover:text-yellow-500',
                preset.isFavourite && 'text-yellow-500',
              )}
              aria-label={t('presets.bookmark')}
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
                    className="transition-colors hover:text-primary"
                    aria-label="More options"
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
                  {t('presets.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 10

type PresetFilter = 'all' | 'bookmarked'

export function PresetsPage() {
  const { t } = useTranslation('dashboard')
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)

  const { presets, deletePreset, toggleFavourite } = useConfigPresets()
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<PresetFilter>('all')
  const [page, setPage] = useState(1)

  const filteredPresets = useMemo(() => {
    let result = presets

    if (filter === 'bookmarked') {
      result = result.filter((p) => p.isFavourite)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          (p.displayName ?? '').toLowerCase().includes(query) ||
          p.blueprintId.toLowerCase().includes(query) ||
          p.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
    }

    return result
  }, [presets, filter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredPresets.length / PAGE_SIZE))
  const paginatedPresets = filteredPresets.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  )

  const handleFilterChange = (newFilter: PresetFilter) => {
    setFilter(newFilter)
    setPage(1)
  }

  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
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
          <H2 className="text-xl font-semibold">{t('presets.page.title')}</H2>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <Input
                type="text"
                placeholder={t('presets.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-10 sm:w-64"
              />
            </div>

            <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
              {(['all', 'bookmarked'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => handleFilterChange(f)}
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
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
              <Bookmark className="h-8 w-8" />
              {searchQuery || filter !== 'all' ? (
                <P>{t('presets.empty.filtered')}</P>
              ) : (
                <>
                  <P className="font-medium">{t('presets.empty.title')}</P>
                  <P className="text-sm">{t('presets.empty.description')}</P>
                </>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-border p-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('presets.pagination.previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('presets.pagination.page', {
                  current: page,
                  total: totalPages,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('presets.pagination.next')}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
