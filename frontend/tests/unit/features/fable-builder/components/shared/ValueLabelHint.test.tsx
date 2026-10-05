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
import { ValueLabelHint } from '@/features/fable-builder/components/shared/ValueLabelHint'

describe('ValueLabelHint', () => {
  it('lists each param on hover', async () => {
    const screen = await renderWithProviders(
      <ValueLabelHint
        label={{
          compact: '2t, msl',
          full: '',
          value: '167,151',
          params: [
            { id: '167', display: '2 metre temperature [K] (2t)' },
            { id: '151', display: 'Mean sea level pressure [Pa] (msl)' },
          ],
        }}
      >
        <span>2t, msl</span>
      </ValueLabelHint>,
    )
    await screen.getByText('2t, msl').hover()
    await expect
      .element(
        screen.getByText('2 metre temperature [K] (2t)', { exact: true }),
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByText('Mean sea level pressure [Pa] (msl)', { exact: true }),
      )
      .toBeVisible()
  })

  it('shows a model name with its wire id', async () => {
    const screen = await renderWithProviders(
      <ValueLabelHint
        label={{
          compact: 'AIFS Global o48',
          full: 'AIFS Global o48',
          value: 'ecmwf:aifs-global-o48',
        }}
      >
        <span>AIFS Global o48</span>
      </ValueLabelHint>,
    )
    await screen.getByText('AIFS Global o48').hover()
    await expect
      .element(screen.getByText('ecmwf:aifs-global-o48', { exact: true }))
      .toBeVisible()
  })

  it('renders an unlabelled value bare', async () => {
    const screen = await renderWithProviders(
      <ValueLabelHint label={undefined}>
        <span>raw</span>
      </ValueLabelHint>,
    )
    await expect.element(screen.getByText('raw')).toBeVisible()
  })
})
