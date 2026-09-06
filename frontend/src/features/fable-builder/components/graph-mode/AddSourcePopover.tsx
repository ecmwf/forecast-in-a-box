/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Canvas-anchored picker of source blocks, opened by the empty configuration
 * panel's "Add a source". Same rows as the downstream add menu; sources only.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  factoryIdToKey,
  getBlockKindIcon,
} from '@/api/types/fable.types'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AddSourcePopoverProps {
  /** Invisible canvas element the popover hangs from. */
  anchor: Element | null
  catalogue: BlockFactoryCatalogue
}

export function AddSourcePopover({ anchor, catalogue }: AddSourcePopoverProps) {
  const { t } = useTranslation('configure')
  const open = useFableBuilderStore((state) => state.addSourceMenuOpen)
  const setOpen = useFableBuilderStore((state) => state.setAddSourceMenuOpen)
  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const [search, setSearch] = useState('')

  const sources = useMemo(() => {
    const out: Array<{ id: PluginBlockFactoryId; factory: BlockFactory }> = []
    for (const [pluginKey, plugin] of Object.entries(catalogue)) {
      const [store, local] = pluginKey.split('/')
      for (const [factoryKey, factory] of Object.entries(plugin.factories)) {
        if (factory.kind !== 'source') continue
        out.push({
          id: { plugin: { store, local }, factory: factoryKey },
          factory,
        })
      }
    }
    const needle = search.trim().toLowerCase()
    if (!needle) return out
    return out.filter(
      ({ factory }) =>
        factory.title.toLowerCase().includes(needle) ||
        factory.description.toLowerCase().includes(needle),
    )
  }, [catalogue, search])

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  if (anchor === null) return null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="center"
        className="w-72 p-0"
        aria-label={t('configPanel.addSource')}
      >
        <div className="border-b p-2">
          <Input
            autoFocus
            placeholder={t('addNode.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {sources.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t('addNode.noBlocksFound')}
            </div>
          ) : (
            sources.map(({ id, factory }) => {
              const Icon = getBlockKindIcon(factory.kind)
              return (
                <button
                  key={factoryIdToKey(id)}
                  type="button"
                  data-factory-key={factoryIdToKey(id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent',
                  )}
                  onClick={() => {
                    addBlock(id, factory)
                    close()
                  }}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      BLOCK_KIND_METADATA[factory.kind].color,
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
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
