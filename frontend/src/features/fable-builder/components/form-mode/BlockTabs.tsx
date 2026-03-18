/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { BlockInstanceCard } from './BlockInstanceCard'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface BlockTabsProps {
  blocks: Array<{ id: BlockInstanceId; factoryId: PluginBlockFactoryId }>
  catalogue: BlockFactoryCatalogue
  selectedBlockId: BlockInstanceId | null
  onSelectBlock: (id: BlockInstanceId) => void
  onAddConnectedBlock: (
    factoryId: PluginBlockFactoryId,
    sourceBlockId: BlockInstanceId,
  ) => void
  onBlockClick: (blockId: BlockInstanceId) => void
  onAddBlock?: () => void
}

/**
 * Tabbed view for multiple blocks of any kind.
 * Shows each block as a tab with BlockInstanceCard inside.
 */
export function BlockTabs({
  blocks,
  catalogue,
  selectedBlockId,
  onSelectBlock,
  onAddConnectedBlock,
  onBlockClick,
  onAddBlock,
}: BlockTabsProps) {
  // Use first block as default if none selected or selection not in list
  const defaultTab =
    blocks.find((b) => b.id === selectedBlockId)?.id || blocks[0]?.id || ''
  const [activeTab, setActiveTab] = useState<string>(defaultTab)

  // Sync activeTab when selectedBlockId changes externally
  useEffect(() => {
    if (selectedBlockId && blocks.some((b) => b.id === selectedBlockId)) {
      setActiveTab(selectedBlockId)
    }
  }, [selectedBlockId, blocks])

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    onSelectBlock(value)
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList className="w-full flex-wrap justify-start">
        {blocks.map(({ id, factoryId }) => {
          const factory = getFactory(catalogue, factoryId)
          const title = factory?.title || 'Block'
          // Truncate long titles
          const displayTitle =
            title.length > 16 ? title.slice(0, 15) + '…' : title

          return (
            <TabsTrigger key={id} value={id}>
              {displayTitle}
            </TabsTrigger>
          )
        })}
        {onAddBlock && (
          <button
            type="button"
            onClick={onAddBlock}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded-md px-3 py-1 text-sm font-medium',
              'text-muted-foreground transition-colors',
              'hover:bg-background/50 hover:text-foreground',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </TabsList>

      {blocks.map(({ id }) => (
        <TabsContent key={id} value={id}>
          <BlockInstanceCard
            instanceId={id}
            catalogue={catalogue}
            isSelected={selectedBlockId === id}
            onAddConnectedBlock={onAddConnectedBlock}
            onBlockClick={onBlockClick}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
