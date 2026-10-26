/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useRef, useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  isFactoryAvailable,
  useAvailableFactoryIds,
} from '@/features/fable-builder/hooks/useAvailableFactoryIds'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  factoryIdToKey,
  flattenCatalogue,
  getBlockKindIcon,
  parseDisplayPluginId,
} from '@/api/types/fable.types'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TOUR, tourActionAttr, tourAttr } from '@/features/tutorials/anchors'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import {
  collidingTitles,
  qualifiedFactoryTitle,
} from '@/features/fable-builder/utils/block-names'
import { BlockName } from '@/features/fable-builder/components/shared/BlockName'

// Transparent image used to suppress the browser's default drag ghost.
const EMPTY_DRAG_IMAGE = new Image()
EMPTY_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface BlockPaletteProps {
  catalogue: BlockFactoryCatalogue
}

interface PaletteEntry {
  id: PluginBlockFactoryId
  key: string
  pluginKey: string
  factory: BlockFactory
  title: string
  isAvailable: boolean
}

export function BlockPalette({ catalogue }: BlockPaletteProps) {
  const { t } = useTranslation('configure')
  const [searchQuery, setSearchQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [openSections, setOpenSections] = useState<Set<BlockKind>>(
    new Set(BLOCK_KIND_ORDER),
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const togglePalette = useFableBuilderStore((state) => state.togglePalette)
  const setDraggedFactory = useFableBuilderStore(
    (state) => state.setDraggedFactory,
  )
  const fable = useFableBuilderStore((state) => state.fable)
  const isValidating = useFableBuilderStore((state) => state.isValidating)
  const usableOnly = useUiStore((state) => state.paletteUsableOnly)
  const setUsableOnly = useUiStore((state) => state.setPaletteUsableOnly)
  const compact = useUiStore((state) => state.paletteCompact)
  const setCompact = useUiStore((state) => state.setPaletteCompact)

  const availableFactoryIds = useAvailableFactoryIds()

  const entries = useMemo<Array<PaletteEntry>>(() => {
    const colliding = collidingTitles(catalogue)
    return flattenCatalogue(catalogue).map(
      ({ pluginId, factoryId, factory }) => {
        const id: PluginBlockFactoryId = {
          plugin: parseDisplayPluginId(pluginId),
          factory: factoryId,
        }
        const key = factoryIdToKey(id)
        return {
          id,
          key,
          pluginKey: pluginId,
          factory,
          title: qualifiedFactoryTitle(factory.title, pluginId, colliding),
          isAvailable: isFactoryAvailable(availableFactoryIds, factory, key),
        }
      },
    )
  }, [catalogue, availableFactoryIds])

  const plugins = useMemo(
    () => [...new Set(entries.map((e) => e.pluginKey))].sort(),
    [entries],
  )

  const pluginCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of entries) {
      counts.set(entry.pluginKey, (counts.get(entry.pluginKey) ?? 0) + 1)
    }
    return counts
  }, [entries])

  // All plugins ticked = no plugin filter.
  const activePlugins = useMemo<ReadonlySet<string>>(() => {
    const ticked = plugins.filter((plugin) => pluginFilter.has(plugin))
    return ticked.length === plugins.length ? new Set() : new Set(ticked)
  }, [plugins, pluginFilter])

  const hasActiveFilters = usableOnly || activePlugins.size > 0

  function resetFilters(): void {
    setUsableOnly(false)
    setPluginFilter(new Set())
  }

  const visible = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return entries.filter(
      (entry) =>
        (!usableOnly || entry.isAvailable) &&
        (activePlugins.size === 0 || activePlugins.has(entry.pluginKey)) &&
        (!query ||
          entry.title.toLowerCase().includes(query) ||
          entry.factory.description.toLowerCase().includes(query) ||
          entry.pluginKey.toLowerCase().includes(query)),
    )
  }, [entries, searchQuery, usableOnly, activePlugins])

  const groupedFactories = useMemo(() => {
    const groups = new Map<BlockKind, Array<PaletteEntry>>(
      BLOCK_KIND_ORDER.map((kind) => [kind, []]),
    )
    for (const entry of visible) groups.get(entry.factory.kind)?.push(entry)
    return groups
  }, [visible])

  // `/` jumps to the search from anywhere on the page.
  useHotkey('/', () => searchRef.current?.focus(), { ignoreInputs: true })

  function toggleSection(kind: BlockKind): void {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function togglePlugin(pluginKey: string): void {
    setPluginFilter((prev) => {
      const next = new Set(prev)
      if (next.has(pluginKey)) next.delete(pluginKey)
      else next.add(pluginKey)
      return next
    })
  }

  // Arrow keys walk the enabled blocks; Enter adds the focused one.
  function focusBlock(from: Element | null, step: 1 | -1): void {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-factory-key]:not(:disabled)',
      ) ?? [],
    )
    if (items.length === 0) return
    const index = from ? items.indexOf(from as HTMLButtonElement) : -1
    const next = index + step
    if (next < 0) searchRef.current?.focus()
    else items[Math.min(next, items.length - 1)].focus()
  }

  function handleDragStart(e: React.DragEvent, entry: PaletteEntry): void {
    setDraggedFactory({ id: entry.id, factory: entry.factory })
    e.dataTransfer.effectAllowed = 'copy'
    // Some browsers require a data payload for the drag to start.
    e.dataTransfer.setData('text/plain', entry.factory.title)
    // Hide the browser's default ghost — <BlockDragPreview> renders our own.
    e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0)
  }

  const renderEntry = (entry: PaletteEntry) => {
    const IconComponent = getBlockKindIcon(entry.factory.kind)
    const canInteract = entry.isAvailable && !isValidating
    return (
      <button
        key={entry.key}
        data-factory-key={entry.key}
        {...tourActionAttr('add-block')}
        draggable={canInteract}
        onClick={() => canInteract && addBlock(entry.id, entry.factory)}
        onDragStart={(e) => handleDragStart(e, entry)}
        onDragEnd={() => setDraggedFactory(null)}
        disabled={!canInteract}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md border border-transparent text-left transition-all focus-visible:border-ring focus-visible:outline-none',
          compact ? 'px-2 py-1' : 'p-2',
          canInteract && 'cursor-grab hover:border-border hover:bg-muted/50',
          !entry.isAvailable && 'cursor-not-allowed opacity-40',
        )}
        title={
          !entry.isAvailable
            ? t('palette.notAvailableAtStep')
            : compact
              ? `${entry.title} — ${entry.factory.description}`
              : t('palette.addBlock', { title: entry.title })
        }
      >
        <div
          className={cn(
            'shrink-0',
            BLOCK_KIND_METADATA[entry.factory.kind].color,
          )}
        >
          <IconComponent className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <P className="truncate font-medium">
            <BlockName name={entry.title} />
          </P>
          {!compact && (
            <P className="line-clamp-2 text-muted-foreground">
              {entry.factory.description}
            </P>
          )}
        </div>
        <Plus
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-opacity',
            canInteract
              ? 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
              : 'opacity-0',
          )}
        />
      </button>
    )
  }

  const nothingFound = visible.length === 0

  return (
    <div className="flex h-full flex-col" {...tourAttr(TOUR.configure.palette)}>
      <div className="space-y-2.5 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <H2 className="text-sm font-semibold">{t('palette.title')}</H2>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 max-lg:hidden"
            onClick={togglePalette}
            title={t('layout.hideBlockPalette')}
            aria-label={t('layout.hideBlockPalette')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              placeholder={t('palette.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  focusBlock(null, 1)
                }
              }}
              className="peer h-9 pr-8 pl-9"
            />
            {/* Shortcut hint; hidden while searching. */}
            <kbd
              title={t('palette.searchShortcut')}
              onClick={() => searchRef.current?.focus()}
              className="absolute top-2 right-2 cursor-default rounded border border-border px-1.5 font-mono text-xs text-muted-foreground peer-not-placeholder-shown:hidden peer-focus:hidden"
            >
              /
            </kbd>
          </div>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="relative h-9 w-9 shrink-0"
                  aria-label={t('palette.filter')}
                  title={t('palette.filter')}
                />
              }
            >
              <ListFilter className="h-4 w-4" />
              {hasActiveFilters && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
                />
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-3 p-3">
              <div className="space-y-2">
                <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('palette.show')}
                </P>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={usableOnly}
                    onCheckedChange={(checked) => setUsableOnly(checked)}
                  />
                  {t('palette.usableOnly')}
                </label>
              </div>
              {plugins.length > 1 && (
                <div className="space-y-2">
                  <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('palette.plugins')}
                  </P>
                  {plugins.map((pluginKey) => (
                    <label
                      key={pluginKey}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={pluginFilter.has(pluginKey)}
                        onCheckedChange={() => togglePlugin(pluginKey)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {pluginLabel(pluginKey)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {pluginCounts.get(pluginKey) ?? 0}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="space-y-2 border-t pt-3">
                <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('palette.view')}
                </P>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={compact}
                    onCheckedChange={(checked) => setCompact(checked)}
                  />
                  {t('palette.compact')}
                </label>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={resetFilters}
                >
                  {t('palette.resetFilters')}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5">
            {usableOnly && (
              <FilterChip
                label={t('palette.usableOnly')}
                removeLabel={t('palette.removeFilter', {
                  filter: t('palette.usableOnly'),
                })}
                onRemove={() => setUsableOnly(false)}
              />
            )}
            {[...activePlugins].map((pluginKey) => (
              <FilterChip
                key={pluginKey}
                label={pluginLabel(pluginKey)}
                removeLabel={t('palette.removeFilter', {
                  filter: pluginLabel(pluginKey),
                })}
                onRemove={() => togglePlugin(pluginKey)}
              />
            ))}
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-1 overflow-y-auto px-2 py-2"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          if (!(e.target instanceof HTMLButtonElement)) return
          if (!e.target.dataset.factoryKey) return
          e.preventDefault()
          focusBlock(e.target, e.key === 'ArrowDown' ? 1 : -1)
        }}
      >
        {nothingFound && (
          <P className="px-2 py-4 text-center text-muted-foreground">
            {t('palette.noMatches')}
          </P>
        )}

        {BLOCK_KIND_ORDER.map((kind) => {
          const factories = groupedFactories.get(kind) ?? []
          const metadata = BLOCK_KIND_METADATA[kind]
          const isOpen = openSections.has(kind)
          if (factories.length === 0 && (searchQuery || nothingFound)) {
            return null
          }
          const availableCount = factories.filter((f) => f.isAvailable).length

          return (
            <Collapsible
              key={kind}
              open={isOpen}
              onOpenChange={() => toggleSection(kind)}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-medium hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={metadata.color}>{metadata.label}</span>
                  <Badge
                    variant={availableCount > 0 ? 'secondary' : 'outline'}
                    className={cn(
                      'px-1.5 py-0 text-sm',
                      availableCount === 0 && 'opacity-50',
                    )}
                  >
                    {availableFactoryIds !== null && !usableOnly
                      ? `${availableCount}/${factories.length}`
                      : factories.length}
                  </Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-2">
                <div className="ml-6 space-y-1">
                  {factories.map((entry) => renderEntry(entry))}
                  {factories.length === 0 && (
                    <P className="px-2 py-2 text-muted-foreground">
                      {t('palette.noBlocksAvailable', {
                        kind: metadata.label.toLowerCase(),
                      })}
                    </P>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>

      <div className="border-t border-border bg-muted/30 p-3">
        <P className="text-center text-muted-foreground">
          {isValidating
            ? t('palette.loadingBlocks')
            : Object.keys(fable.blocks).length === 0
              ? t('palette.clickSourceToStart')
              : t('palette.clickToAdd')}
        </P>
      </div>
    </div>
  )
}

const pluginLabel = (pluginKey: string) =>
  pluginKey.split('/').pop() ?? pluginKey

function FilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string
  removeLabel: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 py-0.5 pr-1 pl-2.5 text-sm text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="rounded-full p-0.5 hover:bg-primary/10"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
