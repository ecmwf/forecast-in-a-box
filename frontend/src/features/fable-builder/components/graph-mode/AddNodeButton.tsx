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
import { Plus } from 'lucide-react'

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
import { Button } from '@/components/ui/button'
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
}

const POSITION_CLASSES: Record<string, string> = {
  TB: 'absolute -bottom-4 left-1/2 -translate-x-1/2',
  LR: 'absolute -right-4 top-1/2 -translate-y-1/2',
  BT: 'absolute -top-4 left-1/2 -translate-x-1/2',
  RL: 'absolute -left-4 top-1/2 -translate-y-1/2',
}

const POPOVER_SIDE: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
  TB: 'bottom',
  LR: 'right',
  BT: 'top',
  RL: 'left',
}

export const AddNodeButton = memo(function AddNodeButton({
  sourceBlockId,
  possibleExpansions,
  catalogue,
}: AddNodeButtonProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const layoutDirection = useFableBuilderStore((state) => state.layoutDirection)

  const availableFactories = useMemo(
    () =>
      possibleExpansions
        .map((id) => ({
          id,
          factory: getFactory(catalogue, id),
        }))
        .filter(
          (item): item is { id: PluginBlockFactoryId; factory: BlockFactory } =>
            item.factory !== undefined,
        ),
    [possibleExpansions, catalogue],
  )

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
      Array<{ id: PluginBlockFactoryId; factory: BlockFactory }>
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
  ) => {
    const newBlockId = addBlock(factoryId, factory)

    if (factory.inputs.length > 0) {
      connectBlocks(newBlockId, factory.inputs[0], sourceBlockId)
    }

    setOpen(false)
    setSearch('')
  }

  if (possibleExpansions.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon"
            variant="outline"
            className={cn(
              POSITION_CLASSES[layoutDirection],
              'h-7 w-7 rounded-full',
              'border-2 bg-background shadow-md',
              'hover:border-primary hover:bg-primary hover:text-primary-foreground',
              'nodrag nopan transition-all duration-200',
            )}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Plus className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side={POPOVER_SIDE[layoutDirection]}
        align="center"
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b p-2">
          <Input
            placeholder="Search blocks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {Object.keys(groupedFactories).length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No blocks found
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

                  {factories.map(({ id, factory }) => {
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
                        onClick={() => handleAddBlock(id, factory)}
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
