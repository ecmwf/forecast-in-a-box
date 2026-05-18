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
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  factoryIdToKey,
  flattenCatalogue,
  getBlockKindIcon,
  parseDisplayPluginId,
} from '@/api/types/fable.types'
import { H2, P } from '@/components/base/typography'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// Transparent image used to suppress the browser's default drag ghost.
const EMPTY_DRAG_IMAGE = new Image()
EMPTY_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface BlockPaletteProps {
  catalogue: BlockFactoryCatalogue
}

export function BlockPalette({ catalogue }: BlockPaletteProps) {
  const { t } = useTranslation('configure')
  const [searchQuery, setSearchQuery] = useState('')
  const [openSections, setOpenSections] = useState<Set<BlockKind>>(
    new Set(BLOCK_KIND_ORDER),
  )
  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const setDraggedFactory = useFableBuilderStore(
    (state) => state.setDraggedFactory,
  )
  const fable = useFableBuilderStore((state) => state.fable)
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)

  const blockCount = Object.keys(fable.blocks).length

  const availableFactoryIds = useMemo(() => {
    if (blockCount === 0) {
      if (!validationState) {
        // Validation not available yet — signal sources-only mode.
        // TODO: Change when backend validation works properly
        return 'sources-only' as const
      }
      return new Set(
        validationState.possibleSources.map((id) => factoryIdToKey(id)),
      )
    }

    if (!validationState) return null

    const allExpansions = new Set<string>()
    for (const blockState of Object.values(validationState.blockStates)) {
      for (const expansion of blockState.possibleExpansions) {
        allExpansions.add(factoryIdToKey(expansion))
      }
    }
    // No expansions (e.g. a block has errors) → keep every block available
    // instead of greying the palette. Mirrors AddNodeButton's fallback.
    return allExpansions.size > 0 ? allExpansions : null
  }, [validationState, blockCount])

  const groupedFactories = useMemo(() => {
    const groups = new Map<
      BlockKind,
      Array<{
        id: PluginBlockFactoryId
        factory: BlockFactory
        isAvailable: boolean
      }>
    >()

    for (const kind of BLOCK_KIND_ORDER) {
      groups.set(kind, [])
    }

    const query = searchQuery.toLowerCase()
    const flatCatalogue = flattenCatalogue(catalogue)
    for (const { pluginId, factoryId, factory } of flatCatalogue) {
      if (
        query &&
        !factory.title.toLowerCase().includes(query) &&
        !factory.description.toLowerCase().includes(query)
      ) {
        continue
      }
      const group = groups.get(factory.kind)
      if (group) {
        const pluginBlockFactoryId: PluginBlockFactoryId = {
          plugin: parseDisplayPluginId(pluginId),
          factory: factoryId,
        }
        const key = factoryIdToKey(pluginBlockFactoryId)
        const isAvailable =
          availableFactoryIds === null ||
          (availableFactoryIds === 'sources-only'
            ? factory.kind === 'source'
            : availableFactoryIds.has(key))
        group.push({ id: pluginBlockFactoryId, factory, isAvailable })
      }
    }

    return groups
  }, [catalogue, searchQuery, availableFactoryIds])

  function toggleSection(kind: BlockKind): void {
    setOpenSections((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(kind)) {
        newSet.delete(kind)
      } else {
        newSet.add(kind)
      }
      return newSet
    })
  }

  function handleAddBlock(
    factoryId: PluginBlockFactoryId,
    factory: BlockFactory,
  ): void {
    addBlock(factoryId, factory)
  }

  function handleDragStart(
    e: React.DragEvent,
    factoryId: PluginBlockFactoryId,
    factory: BlockFactory,
  ): void {
    setDraggedFactory({ id: factoryId, factory })
    e.dataTransfer.effectAllowed = 'copy'
    // Some browsers require a data payload for the drag to start.
    e.dataTransfer.setData('text/plain', factory.title)
    // Hide the browser's default ghost — <BlockDragPreview> renders our own.
    e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <H2 className="mb-3 text-sm font-semibold">{t('palette.title')}</H2>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('palette.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {BLOCK_KIND_ORDER.map((kind) => {
          const factories = groupedFactories.get(kind) || []
          const metadata = BLOCK_KIND_METADATA[kind]
          const isOpen = openSections.has(kind)

          if (factories.length === 0 && searchQuery) {
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
                    {availableFactoryIds !== null
                      ? `${availableCount}/${factories.length}`
                      : factories.length}
                  </Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-2">
                <div className="ml-6 space-y-1">
                  {factories.map(({ id, factory, isAvailable }) => {
                    const IconComponent = getBlockKindIcon(factory.kind)
                    const canInteract = isAvailable && !isValidating

                    return (
                      <button
                        key={factoryIdToKey(id)}
                        draggable={canInteract}
                        onClick={() =>
                          canInteract && handleAddBlock(id, factory)
                        }
                        onDragStart={(e) => handleDragStart(e, id, factory)}
                        onDragEnd={() => setDraggedFactory(null)}
                        disabled={!canInteract}
                        className={cn(
                          'group flex w-full items-center gap-2 rounded-md border border-transparent p-2 text-left transition-all',
                          canInteract &&
                            'cursor-grab hover:border-border hover:bg-muted/50',
                          !isAvailable && 'cursor-not-allowed opacity-40',
                        )}
                        title={
                          !isAvailable
                            ? t('palette.notAvailableAtStep')
                            : t('palette.addBlock', { title: factory.title })
                        }
                      >
                        <div
                          className={cn(
                            'shrink-0',
                            BLOCK_KIND_METADATA[factory.kind].color,
                          )}
                        >
                          <IconComponent className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <P className="truncate font-medium">
                            {factory.title}
                          </P>
                          <P className="truncate text-muted-foreground">
                            {factory.description}
                          </P>
                        </div>
                        <Plus
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-opacity',
                            canInteract
                              ? 'opacity-0 group-hover:opacity-100'
                              : 'opacity-0',
                          )}
                        />
                      </button>
                    )
                  })}

                  {factories.length === 0 && !searchQuery && (
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
