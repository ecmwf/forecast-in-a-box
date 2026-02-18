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
import { formatDistanceToNow } from 'date-fns'
import { useConfigPresets } from '../hooks/useConfigPresets'
import type { PresetEntry } from '../hooks/useConfigPresets'
import type { FableBlockSummary } from '@/features/fable-builder/components/SaveConfigPopover'
import { BLOCK_KIND_METADATA, BLOCK_KIND_ORDER } from '@/api/types/fable.types'
import { PageHeader } from '@/components/common'
import { H2, P } from '@/components/base/typography'
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

function BlockSummaryTags({ summary }: { summary: FableBlockSummary }) {
  return (
    <div className="flex flex-wrap gap-2">
      {BLOCK_KIND_ORDER.filter(
        (kind) => summary[kind as keyof FableBlockSummary] > 0,
      ).map((kind) => {
        const meta = BLOCK_KIND_METADATA[kind]
        const count = summary[kind as keyof FableBlockSummary]
        return (
          <span
            key={kind}
            className="rounded bg-muted px-2 py-1 text-sm text-muted-foreground"
          >
            {count} {meta.label.toLowerCase()}
            {count !== 1 ? 's' : ''}
          </span>
        )
      })}
    </div>
  )
}

function RenamePopover({
  preset,
  onRename,
}: {
  preset: PresetEntry
  onRename: (fableId: string, title: string, comments: string) => void
}) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(preset.title)
  const [comments, setComments] = useState(preset.comments)

  function handleOpen(nextOpen: boolean) {
    if (nextOpen) {
      setTitle(preset.title)
      setComments(preset.comments)
    }
    setOpen(nextOpen)
  }

  function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) return
    onRename(preset.fableId, trimmed, comments.trim())
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
          <Label htmlFor={`rename-title-${preset.fableId}`}>Title</Label>
          <Input
            id={`rename-title-${preset.fableId}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rename-comments-${preset.fableId}`}>Comments</Label>
          <textarea
            id={`rename-comments-${preset.fableId}`}
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

const PAGE_SIZE = 10

type PresetFilter = 'all' | 'bookmarked'

export function PresetsPage() {
  const { t } = useTranslation('dashboard')
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)

  const { presets, deletePreset, toggleFavourite, renamePreset } =
    useConfigPresets()
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
          p.title.toLowerCase().includes(query) ||
          p.comments.toLowerCase().includes(query),
      )
    }

    return result
  }, [presets, filter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredPresets.length / PAGE_SIZE))
  const paginatedPresets = filteredPresets.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  )

  // Reset page when filters change
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
              <div
                key={preset.fableId}
                className="p-6 transition-colors hover:bg-muted/50"
              >
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  {/* Content */}
                  <div className="grow">
                    <div className="mb-1 flex items-center gap-2">
                      <P className="truncate font-medium">{preset.title}</P>
                      <RenamePopover preset={preset} onRename={renamePreset} />
                    </div>
                    {preset.comments && (
                      <P className="mb-2 line-clamp-1 text-sm text-muted-foreground">
                        {preset.comments}
                      </P>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <BlockSummaryTags summary={preset.summary} />
                      <P className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(preset.savedAt), {
                          addSuffix: true,
                        })}
                      </P>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-sm"
                      render={
                        <Link
                          to="/configure"
                          search={{ fableId: preset.fableId }}
                        />
                      }
                      nativeButton={false}
                    >
                      {t('presets.load')}
                    </Button>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <button
                        onClick={() => toggleFavourite(preset.fableId)}
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
                            onClick={() => deletePreset(preset.fableId)}
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
