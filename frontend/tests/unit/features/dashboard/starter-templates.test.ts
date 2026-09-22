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
import type { TemplateEntry } from '@/features/dashboard/hooks/useTemplatePresets'
import { templateConfigureSearch } from '@/features/dashboard/hooks/useTemplatePresets'
import { selectStarterTemplates } from '@/features/dashboard/hooks/useStarterTemplates'

const ECMWF = 'ecmwf:ecmwf-base'

function template(
  displayName: string | null,
  overrides: Partial<TemplateEntry> = {},
): TemplateEntry {
  return {
    blueprintId: `bp-${displayName}`,
    version: 1,
    displayName,
    displayDescription: 'desc',
    tags: [],
    pluginId: ECMWF,
    pluginLabel: 'ecmwf-base',
    coreVersionMismatch: null,
    ...overrides,
  }
}

const names = (entries: Array<TemplateEntry>) =>
  entries.map((e) => e.displayName)

describe('selectStarterTemplates', () => {
  it('orders by the plugin declaration order, not the list order', () => {
    const result = selectStarterTemplates(
      [template('C'), template('A'), template('B')],
      { [ECMWF]: ['A', 'B', 'C'] },
    )

    expect(names(result)).toEqual(['A', 'B', 'C'])
  })

  it('caps at the limit', () => {
    const result = selectStarterTemplates(
      [template('A'), template('B'), template('C'), template('D')],
      { [ECMWF]: ['A', 'B', 'C', 'D'] },
    )

    expect(names(result)).toEqual(['A', 'B', 'C'])
  })

  it('fills the gap left by a template that failed to ingest', () => {
    // 'A' is declared but has no row, so 'D' moves up rather than a card vanishing.
    const result = selectStarterTemplates(
      [template('B'), template('C'), template('D')],
      { [ECMWF]: ['A', 'B', 'C', 'D'] },
    )

    expect(names(result)).toEqual(['B', 'C', 'D'])
  })

  it('prefers the ECMWF templates when that plugin is installed', () => {
    const result = selectStarterTemplates(
      [
        template('A'),
        template('Other', { pluginId: 'local:plugin-test' }),
        template('B'),
      ],
      { [ECMWF]: ['A', 'Other', 'B'] },
    )

    expect(names(result)).toEqual(['A', 'B'])
  })

  it('ignores rows with no display name, since that is the join key', () => {
    const result = selectStarterTemplates([template(null), template('A')], {
      [ECMWF]: ['A'],
    })

    expect(names(result)).toEqual(['A'])
  })

  it('keeps the first of two rows sharing a display name', () => {
    const first = template('A', { blueprintId: 'first' })
    const second = template('A', { blueprintId: 'second' })

    const result = selectStarterTemplates([first, second], { [ECMWF]: ['A'] })

    expect(result).toHaveLength(1)
    expect(result[0].blueprintId).toBe('first')
  })

  it('falls back to list order when the plugin declares none', () => {
    // /plugin/list unavailable or an older backend: keep the cards, lose the order.
    const result = selectStarterTemplates(
      [template('C'), template('A'), template('B'), template('D')],
      { [ECMWF]: [] },
    )

    expect(names(result)).toEqual(['C', 'A', 'B'])
  })

  it('falls back to other plugins, each in its declared order', () => {
    const result = selectStarterTemplates(
      [
        template('Z', { pluginId: 'local:single' }),
        template('Y', { pluginId: 'local:single' }),
        template('Q', { pluginId: 'local:other' }),
      ],
      { 'local:other': ['Q'], 'local:single': ['Y', 'Z'] },
    )
    expect(names(result)).toEqual(['Q', 'Y', 'Z'])
  })

  it('returns nothing when no plugin ships a template', () => {
    expect(selectStarterTemplates([], {})).toEqual([])
    expect(selectStarterTemplates([template(null)], {})).toEqual([])
  })

  it('honours an explicit limit', () => {
    const result = selectStarterTemplates(
      [template('A'), template('B')],
      { [ECMWF]: ['A', 'B'] },
      1,
    )

    expect(names(result)).toEqual(['A'])
  })
})

describe('templateConfigureSearch', () => {
  it('forks the template and names it, so the params dialog can open', () => {
    expect(templateConfigureSearch(template('Snapshot'))).toEqual({
      fableId: 'bp-Snapshot',
      template: true,
      templatePlugin: ECMWF,
      templateName: 'Snapshot',
    })
  })

  it('omits the plugin and name when unknown', () => {
    expect(templateConfigureSearch(template(null, { pluginId: null }))).toEqual(
      {
        fableId: 'bp-null',
        template: true,
      },
    )
  })
})
