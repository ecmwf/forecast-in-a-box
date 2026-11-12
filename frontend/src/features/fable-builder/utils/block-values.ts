/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A block's set configuration values as shown on its graph card. */

import type { BlockConfigurationOption } from '@/api/types/fable.types'

export interface BlockValueEntry {
  key: string
  /** The setting's title, falling back to its key. */
  title: string
  value: string
  /** Equal to the setting's default. */
  isDefault: boolean
}

/** Set values in setting order, the user's choices before the defaults. */
export function blockValueEntries(
  values: Record<string, string>,
  options: Record<string, BlockConfigurationOption | undefined>,
): Array<BlockValueEntry> {
  // Settings first, then values the factory no longer lists.
  const keys = [
    ...Object.keys(options),
    ...Object.keys(values).filter((key) => !(key in options)),
  ]
  const entries = keys.flatMap((key): Array<BlockValueEntry> => {
    const value = values[key]
    if (!value) return []
    const option = options[key]
    const fallback = option?.default_value
    return [
      {
        key,
        title: option?.title || key,
        value,
        isDefault: fallback != null && fallback !== '' && value === fallback,
      },
    ]
  })
  return [
    ...entries.filter((e) => !e.isDefault),
    ...entries.filter((e) => e.isDefault),
  ]
}
