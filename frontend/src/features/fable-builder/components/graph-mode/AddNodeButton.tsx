/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockInstanceId,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  factoryIdToKey,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AddNodeButtonProps {
  sourceBlockId: BlockInstanceId
  possibleExpansions: Array<PluginBlockFactoryId>
  catalogue: BlockFactoryCatalogue
  /** The block's output `<Handle>` — it doubles as the add-menu trigger. */
  children: React.ReactElement
}

const POPOVER_SIDE: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
  TB: 'bottom',
  LR: 'right',
  BT: 'top',
  RL: 'left',
}

const EMPTY_EXPANSION_RESTRICTIONS: Record<string, Record<string, string>> = {}
const EMPTY_CONFIG_RESTRICTIONS: Record<string, string> = {}

/** Wraps a block's output `<Handle>` with an add-downstream-block popover:
 *  clicking the handle opens the menu, dragging it still draws a connection. */
export const AddNodeButton = memo(function ({
  sourceBlockId,
  possibleExpansions,
  catalogue,
  children,
}: AddNodeButtonProps) {
  const { t } = useTranslation('configure')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const setBlockConfigurationRestrictions = useFableBuilderStore(
    (state) => state.setBlockConfigurationRestrictions,
  )
  const blocks = useFableBuilderStore((state) => state.fable.blocks)
  const layoutDirection = useFableBuilderStore((state) => state.layoutDirection)
  const expansionRestrictions = useFableBuilderStore(
    (state) =>
      state.validationState?.blockStates[sourceBlockId]
        ?.possibleExpansionRestrictions ?? EMPTY_EXPANSION_RESTRICTIONS,
  )
  const beginHistoryTransaction = useFableBuilderStore(
    (state) => state.beginHistoryTransaction,
  )
  const endHistoryTransaction = useFableBuilderStore(
    (state) => state.endHistoryTransaction,
  )

  // When the backend provides validated expansions, use them. Otherwise build
  // a fallback from the full catalogue (all factories that accept inputs) so
  // the user can always add blocks even when the parent node has errors.
  const availableFactories = useMemo(() => {
    if (possibleExpansions.length > 0) {
      return possibleExpansions
        .map((id) => ({
          id,
          factory: getFactory(catalogue, id),
          restrictions:
            expansionRestrictions[factoryIdToKey(id)] ??
            EMPTY_CONFIG_RESTRICTIONS,
        }))
        .filter(
          (
            item,
          ): item is {
            id: PluginBlockFactoryId
            factory: BlockFactory
            restrictions: Record<string, string>
          } => item.factory !== undefined,
        )
    }

    // Fallback: all factories with at least one input (i.e. can be downstream)
    const fallback: Array<{
      id: PluginBlockFactoryId
      factory: BlockFactory
      restrictions: Record<string, string>
    }> = []
    for (const [pluginKey, plugin] of Object.entries(catalogue)) {
      for (const [factoryKey, factory] of Object.entries(plugin.factories)) {
        if (factory.inputs.length > 0) {
          // Reconstruct the PluginBlockFactoryId — pluginKey is "store/local"
          const [store, local] = pluginKey.split('/')
          fallback.push({
            id: { plugin: { store, local }, factory: factoryKey },
            factory,
            restrictions: {},
          })
        }
      }
    }
    return fallback
  }, [possibleExpansions, catalogue, expansionRestrictions])

  const filteredFactories = useMemo(() => {
    if (!search.trim()) return availableFactories

    const searchLower = search.toLowerCase()
    return availableFactories.filter(
      ({ factory }) =>
        factory.title.toLowerCase().includes(searchLower) ||
        factory.description.toLowerCase().includes(searchLower),
    )
  }, [availableFactories, search])

  const groupedFactories = useMemo(() => {
    const groups: Record<
      string,
      Array<{
        id: PluginBlockFactoryId
        factory: BlockFactory
        restrictions: Record<string, string>
      }>
    > = {}

    for (const item of filteredFactories) {
      const kind = item.factory.kind
      groups[kind] ??= []
      groups[kind].push(item)
    }

    return groups
  }, [filteredFactories])

  const handleAddBlock = (
    factoryId: PluginBlockFactoryId,
    factory: BlockFactory,
    restrictions: Record<string, string>,
  ) => {
    // Splice: redirect existing consumers of sourceBlockId through the new
    // block. Skipped for sinks and 0-input factories (can't slot in).
    const canSplice = factory.kind !== 'sink' && factory.inputs.length > 0
    const downstream = canSplice
      ? Object.entries(blocks).flatMap(([id, block]) =>
          Object.entries(block.input_ids)
            .filter(([, parentId]) => parentId === sourceBlockId)
            .map(([inputName]) => ({ id, inputName })),
        )
      : []

    // Group add + connect + splice rewires into a single undo step.
    beginHistoryTransaction()
    try {
      const newBlockId = addBlock(factoryId, factory)

      if (factory.inputs.length > 0) {
        connectBlocks(newBlockId, factory.inputs[0], sourceBlockId)
      }
      setBlockConfigurationRestrictions(newBlockId, restrictions)

      for (const { id, inputName } of downstream) {
        connectBlocks(id, inputName, newBlockId)
      }
    } finally {
      endHistoryTransaction()
    }

    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The trigger is the output `<Handle>` (a div), not a native button. */}
      <PopoverTrigger nativeButton={false} render={children} />
      <PopoverContent
        className="w-72 p-0"
        side={POPOVER_SIDE[layoutDirection]}
        align="center"
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b p-2">
          <Input
            placeholder={t('addNode.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {Object.keys(groupedFactories).length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t('addNode.noBlocksFound')}
            </div>
          ) : (
            Object.entries(groupedFactories).map(([kind, factories]) => {
              const metadata =
                BLOCK_KIND_METADATA[kind as keyof typeof BLOCK_KIND_METADATA]

              return (
                <div key={kind} className="mb-2 last:mb-0">
                  <div className="px-2 py-1 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
                    {metadata.label}
                  </div>

                  {factories.map(({ id, factory, restrictions }) => {
                    const IconComponent = getBlockKindIcon(factory.kind)
                    const itemMetadata = BLOCK_KIND_METADATA[factory.kind]

                    return (
                      <button
                        key={factoryIdToKey(id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md p-2',
                          'text-left hover:bg-accent',
                          'transition-colors',
                        )}
                        onClick={() =>
                          handleAddBlock(id, factory, restrictions)
                        }
                      >
                        <IconComponent
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            itemMetadata.color,
                          )}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {factory.title}
                          </div>
                          <div className="line-clamp-1 text-sm text-muted-foreground">
                            {factory.description}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})
