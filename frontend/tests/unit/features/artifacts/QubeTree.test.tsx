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
import { renderWithProviders } from '@tests/utils/render'
import type { QubeNode } from '@/api/types/artifacts.types'
import { QubeTree } from '@/features/artifacts/components/QubeTree'

const sampleQube: QubeNode = {
  key: 'root',
  values: { type: 'enum', dtype: 'str', values: ['root'] },
  metadata: {},
  children: [
    {
      key: 'levtype',
      values: { type: 'enum', dtype: 'str', values: ['pl'] },
      metadata: {
        name: { shape: [1, 1, 1], dtype: 'str', values: ['pressure'] },
      },
      children: [
        {
          key: 'param',
          values: {
            type: 'enum',
            dtype: 'str',
            values: ['q', 't', 'u', 'v', 'w', 'z'],
          },
          metadata: {},
          children: [
            {
              key: 'level',
              values: {
                type: 'enum',
                dtype: 'int64',
                values: [50, 500, 1000],
              },
              metadata: {},
              children: [],
            },
          ],
        },
      ],
    },
    {
      key: 'levtype',
      values: { type: 'enum', dtype: 'str', values: ['sfc'] },
      metadata: {
        name: { shape: [1, 1, 1], dtype: 'str', values: ['surface'] },
      },
      children: [
        {
          key: 'param',
          values: {
            type: 'enum',
            dtype: 'str',
            values: ['2t', 'msl', 'sp'],
          },
          metadata: {},
          children: [],
        },
      ],
    },
  ],
}

const emptyQube: QubeNode = {
  key: 'root',
  values: { type: 'enum', dtype: 'str', values: ['root'] },
  metadata: {},
  children: [],
}

/**
 * Mirrors the canonical example from the qubed docs — a non-AIFS qube with
 * `class → expver → param` shape. Exercises the generic compressed-tree
 * dispatch path.
 */
const genericQube: QubeNode = {
  key: 'root',
  values: { type: 'enum', dtype: 'str', values: ['root'] },
  metadata: {},
  children: [
    {
      key: 'class',
      values: { type: 'enum', dtype: 'str', values: ['od'] },
      metadata: {},
      children: [
        {
          key: 'expver',
          values: { type: 'enum', dtype: 'str', values: ['0001', '0002'] },
          metadata: {},
          children: [
            {
              key: 'foo',
              values: { type: 'enum', dtype: 'int64', values: [1, 2] },
              metadata: {},
              children: [],
            },
          ],
        },
      ],
    },
    {
      key: 'class',
      values: { type: 'enum', dtype: 'str', values: ['rd'] },
      metadata: {},
      children: [
        {
          key: 'expver',
          values: { type: 'enum', dtype: 'str', values: ['0001'] },
          metadata: {},
          children: [
            {
              key: 'foo',
              values: { type: 'enum', dtype: 'int64', values: [1, 2, 3] },
              metadata: {},
              children: [],
            },
          ],
        },
        {
          key: 'expver',
          values: { type: 'enum', dtype: 'str', values: ['0002'] },
          metadata: {},
          children: [
            {
              key: 'foo',
              values: { type: 'enum', dtype: 'int64', values: [1, 2] },
              metadata: {},
              children: [],
            },
          ],
        },
      ],
    },
  ],
}

describe('QubeTree (Dimensional Matrix)', () => {
  it('renders the matrix title and section headings', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    await expect.element(screen.getByText('Data Qube Matrix')).toBeVisible()
    await expect.element(screen.getByText('Pressure levels (PL)')).toBeVisible()
    await expect.element(screen.getByText('Surface levels (SFC)')).toBeVisible()
  })

  it('renders pressure-level columns with hPa units', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    // Default: levels are columns. Sorted descending pressure (1000, 500, 50).
    for (const lvl of ['1000 hPa', '500 hPa', '50 hPa']) {
      await expect.element(screen.getByText(lvl).first()).toBeVisible()
    }
  })

  it('renders parameter rows for the pressure section', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    for (const param of ['q', 't', 'u', 'v', 'w', 'z']) {
      await expect.element(screen.getByText(param).first()).toBeVisible()
    }
  })

  it('renders surface params as chips, no level columns', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    for (const param of ['2t', 'msl', 'sp']) {
      await expect.element(screen.getByText(param).first()).toBeVisible()
    }
  })

  it('shows the size summary for the matrix section', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    // 6 params × 3 levels = 18 fields for the pressure branch.
    await expect
      .element(screen.getByText('6 params × 3 levels · 18 fields').first())
      .toBeVisible()
  })

  it('exposes a pivot toggle that swaps axes', async () => {
    const screen = await renderWithProviders(<QubeTree node={sampleQube} />)

    // Toggle exists.
    const toggle = screen.getByText('Levels as rows')
    await expect.element(toggle).toBeVisible()

    await toggle.click()

    // After pivot, the row header axis label should be the level axis.
    await expect.element(screen.getByText('level').first()).toBeVisible()
  })

  it('renders the empty-state message when root has no children', async () => {
    const screen = await renderWithProviders(<QubeTree node={emptyQube} />)

    await expect
      .element(screen.getByText('No output structure available'))
      .toBeVisible()
  })
})

describe('QubeTree (generic compressed-tree fallback)', () => {
  it('switches to the generic tree title when no `param` dim is present', async () => {
    const screen = await renderWithProviders(<QubeTree node={genericQube} />)

    await expect.element(screen.getByText('Data Qube Tree')).toBeVisible()
    // Matrix-only chrome should NOT be in the document.
    expect(screen.getByText('Data Qube Matrix').elements()).toHaveLength(0)
  })

  it('compresses single-child chains onto one line', async () => {
    const screen = await renderWithProviders(<QubeTree node={genericQube} />)

    // class=od chain compresses into a single row (the docs example).
    await expect
      .element(screen.getByText(/class=od, expver=0001\/0002, foo=1\/2/))
      .toBeVisible()
  })

  it('branches where the qube actually branches', async () => {
    const screen = await renderWithProviders(<QubeTree node={genericQube} />)

    // class=rd has two distinct expver branches.
    await expect
      .element(screen.getByText(/expver=0001, foo=1\/2\/3/))
      .toBeVisible()
    await expect
      .element(screen.getByText(/expver=0002, foo=1\/2/))
      .toBeVisible()
  })
})
