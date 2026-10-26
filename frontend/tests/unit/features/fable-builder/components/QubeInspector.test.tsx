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
import { QubeInspector } from '@/features/fable-builder/components/graph-mode/QubeInspector'

function linearQube(dims: Array<[string, Array<string>]>): QubeNode {
  let node: QubeNode | null = null
  for (let i = dims.length - 1; i >= 0; i -= 1) {
    const [key, values] = dims[i]
    node = {
      key,
      values: { type: 'enum', dtype: 'str', values },
      metadata: {},
      children: node ? [node] : [],
    }
  }
  return {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: node ? [node] : [],
  }
}

// Labels come from the MSW resolveDisplay handler (mockParamDisplays).
describe('QubeInspector param labels', () => {
  const QUBE = linearQube([
    ['param', ['167', '151']],
    ['step', ['0', '6']],
  ])

  it('finds param values by name and shows their shortnames', async () => {
    const screen = await renderWithProviders(
      <QubeInspector node={QUBE} narrowing={[]} />,
    )
    await screen.getByRole('textbox').fill('pressure')

    const msl = screen.getByText('msl', { exact: true })
    await expect.element(msl).toBeVisible()
    await msl.hover()
    await expect
      .element(
        screen.getByText('Mean sea level pressure [Pa] (msl)', { exact: true }),
      )
      .toBeVisible()
    // The step axis matches nothing and drops out.
    await expect
      .element(screen.getByText('step', { exact: true }))
      .not.toBeInTheDocument()
  })

  it('orders param values by shortname rather than id', async () => {
    const screen = await renderWithProviders(
      <QubeInspector node={QUBE} narrowing={[]} />,
    )
    // By id, 151 (msl) would come before 167 (2t).
    await screen.getByRole('textbox').fill('metre')
    await expect.element(screen.getByText('msl', { exact: true })).toBeVisible()
    expect(
      screen
        .getByText(/^(2t|msl)$/)
        .elements()
        .map((element) => element.textContent),
    ).toEqual(['2t', 'msl'])
  })
})
