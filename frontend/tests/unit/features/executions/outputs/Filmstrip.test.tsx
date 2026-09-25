/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type { OutputItem } from '@/features/executions/outputs/types'
import { gribStoredAdapter } from '@/features/executions/outputs/adapters/grib'
import { Filmstrip } from '@/features/executions/outputs/viewers/Filmstrip'

const items: Array<OutputItem> = ['a', 'b', 'c'].map((taskId) => ({
  jobId: 'job',
  taskId,
  mimeType: 'application/grib',
  originalBlock: `plot-${taskId}`,
  isAvailable: true,
}))

describe('Filmstrip', () => {
  it('marks the current output and selects another on click', async () => {
    const onSelect = vi.fn()
    const screen = await renderWithProviders(
      <Filmstrip
        items={items}
        activeTaskId="b"
        adapterFor={() => gribStoredAdapter}
        onSelect={onSelect}
      />,
    )

    await expect
      .element(screen.getByRole('button', { name: '2: plot-b' }))
      .toHaveAttribute('aria-current', 'true')
    await screen.getByRole('button', { name: '3: plot-c' }).click()
    expect(onSelect).toHaveBeenCalledWith(items[2])
  })
})
