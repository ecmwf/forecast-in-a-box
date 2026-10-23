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
import type { OutputItem } from '@/features/executions/outputs/types'
import { OutputCard } from '@/features/executions/outputs/OutputCard'
import { GENERIC_ADAPTER } from '@/features/executions/outputs/registry'

function zarrItem(mimeType: string): OutputItem {
  return {
    jobId: 'job-1',
    taskId: 'task-zarr',
    mimeType,
    originalBlock: 'zarr_sink',
    blockName: 'Zarr Sink',
    isAvailable: true,
  }
}

describe('OutputCard', () => {
  it('offers the zip instead of the path download for a fetchable output', async () => {
    const screen = await renderWithProviders(
      <OutputCard
        item={zarrItem('text/plain; fiab-format=zarr; fiab-fetchable=1')}
        adapter={GENERIC_ADAPTER}
        onOpenViewer={() => {}}
      />,
    )
    await expect
      .element(screen.getByRole('button', { name: 'Download .zip' }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Download', exact: true }).elements(),
    ).toHaveLength(0)
  })

  it('keeps the plain download for other outputs', async () => {
    const screen = await renderWithProviders(
      <OutputCard
        item={zarrItem('text/plain')}
        adapter={GENERIC_ADAPTER}
        onOpenViewer={() => {}}
      />,
    )
    await expect
      .element(screen.getByRole('button', { name: 'Download', exact: true }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Download .zip' }).elements(),
    ).toHaveLength(0)
  })
})
