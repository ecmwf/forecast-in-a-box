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
import { useQubeParamLabels } from '@/features/artifacts/hooks/useQubeParamLabels'

function qube(params: Array<string>): QubeNode {
  return {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [
      {
        key: 'param',
        values: { type: 'enum', dtype: 'str', values: params },
        metadata: {},
        children: [],
      },
    ],
  }
}

const QUBES = [qube(['2t', 'lsm']), qube(['167'])]

function Labels() {
  const labels = useQubeParamLabels(QUBES)
  return <div data-testid="labels">{JSON.stringify([...labels])}</div>
}

// Labels come from the MSW resolveDisplay handler (mockParamDisplays).
describe('useQubeParamLabels', () => {
  it('lends id labels to shortname values; others stay unlabelled', async () => {
    const screen = await renderWithProviders(<Labels />)
    await expect.element(screen.getByTestId('labels')).toHaveTextContent(
      JSON.stringify([
        ['167', '2 metre temperature [K] (2t)'],
        ['2t', '2 metre temperature [K] (2t)'],
      ]),
    )
  })
})
