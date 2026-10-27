/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Options that differ between blocks of one type. */

import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  FableBuilderV1,
} from '@/api/types/fable.types'
import { factoryIdToKey, getFactory } from '@/api/types/fable.types'
import { displayKindOf } from '@/components/base/fields/value-type-parser'

/** One differing option of a block. */
export interface BlockSetting {
  /** Option id. */
  key: string
  /** Option title. */
  title: string
  /** As-run value. */
  value: string
  /** Value is a param list. */
  isParam: boolean
}

export type BlockSettings = Readonly<
  Record<BlockInstanceId, ReadonlyArray<BlockSetting>>
>

/** As-run values of glyphed options, by block then option. */
type Resolution = Readonly<
  Partial<Record<string, Readonly<Partial<Record<string, string | null>>>>>
>

/** Per block, set options whose as-run values differ within its type. */
export function distinguishingSettings(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue | undefined,
  resolution: Resolution | undefined,
): BlockSettings {
  const byFactory = new Map<string, Array<BlockInstanceId>>()
  for (const [id, block] of Object.entries(fable.blocks)) {
    const key = factoryIdToKey(block.factory_id)
    byFactory.set(key, [...(byFactory.get(key) ?? []), id])
  }
  // Null as-run falls back to the template.
  const asRun = (id: BlockInstanceId, key: string): string =>
    resolution?.[id]?.[key] ??
    (fable.blocks[id].configuration_values as Partial<Record<string, string>>)[
      key
    ] ??
    ''

  const settings: Record<BlockInstanceId, Array<BlockSetting>> = {}
  for (const ids of byFactory.values()) {
    if (ids.length < 2) continue
    const keys = new Set(
      ids.flatMap((id) => Object.keys(fable.blocks[id].configuration_values)),
    )
    const varying = [...keys].filter(
      (key) => new Set(ids.map((id) => asRun(id, key))).size > 1,
    )
    if (varying.length === 0) continue
    const options = catalogue
      ? getFactory(catalogue, fable.blocks[ids[0]].factory_id)
          ?.configuration_options
      : undefined
    for (const id of ids) {
      settings[id] = varying.flatMap((key) => {
        const value = asRun(id, key)
        if (value === '') return []
        const option = options?.[key]
        return [
          {
            key,
            title: option?.title ?? key,
            value,
            isParam: displayKindOf(option?.value_type) === 'param',
          },
        ]
      })
    }
  }
  return settings
}
