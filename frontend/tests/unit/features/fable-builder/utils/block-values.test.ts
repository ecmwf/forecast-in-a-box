/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import type { BlockConfigurationOption } from '@/api/types/fable.types'
import { blockValueEntries } from '@/features/fable-builder/utils/block-values'

const option = (
  title: string,
  default_value?: string,
): BlockConfigurationOption => ({
  title,
  description: '',
  value_type: 'str',
  default_value,
})

// Map Plot's settings, in their declared order.
const MAP_PLOT = {
  param: option('Parameters'),
  domain: option('Domain', 'global'),
  format: option('Format', 'png'),
  groupby: option('Group By', 'none'),
  splitby: option('Split By', 'step'),
}

describe('blockValueEntries', () => {
  it('puts the choices first, then the defaults, each in setting order', () => {
    const entries = blockValueEntries(
      {
        splitby: 'step',
        format: 'png',
        domain: 'Malawi',
        groupby: 'none',
        param: '2t',
      },
      MAP_PLOT,
    )
    expect(entries.map((e) => [e.key, e.isDefault])).toEqual([
      ['param', false],
      ['domain', false],
      ['format', true],
      ['groupby', true],
      ['splitby', true],
    ])
    expect(entries[1].title).toBe('Domain')
  })

  it('skips empty values and keeps settings the factory no longer lists', () => {
    const entries = blockValueEntries(
      { param: '', domain: 'global', legacy: 'x' },
      MAP_PLOT,
    )
    expect(entries.map((e) => [e.key, e.title, e.isDefault])).toEqual([
      ['legacy', 'legacy', false],
      ['domain', 'Domain', true],
    ])
  })

  it('treats a setting without a default as a choice', () => {
    const [entry] = blockValueEntries({ param: '2t' }, MAP_PLOT)
    expect(entry.isDefault).toBe(false)
  })
})
