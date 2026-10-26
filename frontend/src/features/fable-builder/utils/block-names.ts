/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Readable block names: the plugin is named on title clashes. */

import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  FableBuilderV1,
} from '@/api/types/fable.types'
import {
  flattenCatalogue,
  getFactory,
  pluginIdToDisplayKey,
} from '@/api/types/fable.types'

const QUALIFIER_SEPARATOR = ' · '

/** Splits a display name into its title and plugin qualifier, if any. */
export function splitBlockName(name: string): [string, string | undefined] {
  const at = name.lastIndexOf(QUALIFIER_SEPARATOR)
  if (at < 0) return [name, undefined]
  return [name.slice(0, at), name.slice(at + QUALIFIER_SEPARATOR.length)]
}

/** Factory titles that more than one plugin factory uses. */
export function collidingTitles(catalogue: BlockFactoryCatalogue): Set<string> {
  const seen = new Set<string>()
  const colliding = new Set<string>()
  for (const { factory } of flattenCatalogue(catalogue)) {
    if (seen.has(factory.title)) colliding.add(factory.title)
    seen.add(factory.title)
  }
  return colliding
}

/** A factory title, plus its plugin when another factory shares it. */
export function qualifiedFactoryTitle(
  title: string,
  pluginKey: string,
  colliding: ReadonlySet<string>,
): string {
  if (!colliding.has(title)) return title
  const plugin = pluginKey.split('/').pop() ?? pluginKey
  return `${title}${QUALIFIER_SEPARATOR}${plugin}`
}

/** Display name per block: its title, plus the plugin on a title clash. */
export function blockDisplayNames(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue | undefined,
): Record<BlockInstanceId, string> {
  const colliding = catalogue ? collidingTitles(catalogue) : new Set<string>()
  const names: Record<BlockInstanceId, string> = {}
  for (const [instanceId, { factory_id }] of Object.entries(fable.blocks)) {
    const factory = catalogue ? getFactory(catalogue, factory_id) : undefined
    names[instanceId] = factory
      ? qualifiedFactoryTitle(
          factory.title,
          pluginIdToDisplayKey(factory_id.plugin),
          colliding,
        )
      : factory_id.factory
  }
  return names
}
