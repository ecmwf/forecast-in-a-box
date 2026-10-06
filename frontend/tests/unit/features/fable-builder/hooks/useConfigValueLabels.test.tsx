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
import { useConfigValueLabels } from '@/features/fable-builder/hooks/useConfigValueLabels'

// Labels come from the MSW resolveDisplay and list_models handlers.
function Labels(props: {
  values: Record<string, string>
  valueTypes: Record<string, string | undefined>
}) {
  const labels = useConfigValueLabels(props.values, props.valueTypes)
  return <div data-testid="labels">{JSON.stringify(labels)}</div>
}

describe('useConfigValueLabels', () => {
  it('labels param lists compact and full', async () => {
    const screen = await renderWithProviders(
      <Labels
        values={{ param: '167,151' }}
        valueTypes={{ param: 'list[param]' }}
      />,
    )
    await expect.element(screen.getByTestId('labels')).toHaveTextContent(
      JSON.stringify({
        param: {
          compact: '2t, msl',
          full: '2 metre temperature [K] (2t), Mean sea level pressure [Pa] (msl)',
          value: '167,151',
          params: [
            { id: '167', display: '2 metre temperature [K] (2t)' },
            { id: '151', display: 'Mean sea level pressure [Pa] (msl)' },
          ],
        },
      }),
    )
  })

  it('labels param values typed by a restriction', async () => {
    const screen = await renderWithProviders(
      <Labels
        values={{ values: '167' }}
        valueTypes={{ values: "list[enumClosed[param]('167','151')]" }}
      />,
    )
    await expect.element(screen.getByTestId('labels')).toHaveTextContent(
      JSON.stringify({
        values: {
          compact: '2t',
          full: '2 metre temperature [K] (2t)',
          value: '167',
          params: [{ id: '167', display: '2 metre temperature [K] (2t)' }],
        },
      }),
    )
  })

  it('labels artifact ids from the catalogue', async () => {
    const screen = await renderWithProviders(
      <Labels
        values={{ checkpoint: 'ecmwf:aifs-ens-crps-1.0_w_sdpa' }}
        valueTypes={{
          checkpoint: "enumClosed[artifact]('ecmwf:aifs-ens-crps-1.0_w_sdpa')",
        }}
      />,
    )
    await expect.element(screen.getByTestId('labels')).toHaveTextContent(
      JSON.stringify({
        checkpoint: {
          compact: 'AIFS ENS CRPS 1.0',
          full: 'AIFS ENS CRPS 1.0',
          value: 'ecmwf:aifs-ens-crps-1.0_w_sdpa',
        },
      }),
    )
  })

  it('leaves other types, glyphs and unresolved ids out', async () => {
    const screen = await renderWithProviders(
      <Labels
        values={{ path: '/tmp/x', param: '${params}', other: '999' }}
        valueTypes={{
          path: 'str',
          param: 'list[param]',
          other: 'list[param]',
        }}
      />,
    )
    await expect.element(screen.getByTestId('labels')).toHaveTextContent('{}')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect.element(screen.getByTestId('labels')).toHaveTextContent('{}')
  })
})
