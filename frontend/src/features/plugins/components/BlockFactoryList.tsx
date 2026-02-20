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
 * BlockFactoryList Component
 *
 * List of block factories from a plugin.
 */

import { useMemo } from 'react'
import { BlockFactoryCard } from './BlockFactoryCard'
import type {
  PluginBlockFactoryId,
  PluginCatalogue,
} from '@/api/types/fable.types'
import type { PluginCompositeId } from '@/api/types/plugins.types'
import { BLOCK_KIND_ORDER } from '@/api/types/fable.types'

export interface BlockFactoryListProps {
  pluginId: PluginCompositeId
  pluginCatalogue: PluginCatalogue
  onStartConfiguration: (factoryId: PluginBlockFactoryId) => void
  filterKinds?: Set<string>
}

export function BlockFactoryList({
  pluginId,
  pluginCatalogue,
  onStartConfiguration,
  filterKinds,
}: BlockFactoryListProps) {
  // Sort factories by kind order, then alphabetically, and filter by kind
  const sortedFactories = useMemo(() => {
    const entries = Object.entries(pluginCatalogue.factories).filter(
      ([_, factory]) => !filterKinds || filterKinds.has(factory.kind),
    )

    return entries.sort((a, b) => {
      const kindOrderA = BLOCK_KIND_ORDER.indexOf(a[1].kind)
      const kindOrderB = BLOCK_KIND_ORDER.indexOf(b[1].kind)
      if (kindOrderA !== kindOrderB) {
        return kindOrderA - kindOrderB
      }
      return a[0].localeCompare(b[0])
    })
  }, [pluginCatalogue.factories, filterKinds])

  if (sortedFactories.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        This plugin does not provide any block factories.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sortedFactories.map(([factoryName, factory]) => (
        <BlockFactoryCard
          key={factoryName}
          factory={factory}
          onStartConfiguration={() =>
            onStartConfiguration({
              plugin: pluginId,
              factory: factoryName,
            })
          }
        />
      ))}
    </div>
  )
}
