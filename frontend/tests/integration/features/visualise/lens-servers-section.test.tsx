/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import {
  injectMockLens,
  listMockLenses,
  resetLensState,
} from '@tests/../mocks/data/lens.data'
import {
  registerMockWmsServer,
  resetWmsState,
} from '@tests/../mocks/data/wms.data'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { LensServersSection } from '@/features/visualise/components/LensServersSection'

function lens(
  id: string,
  status: LensInstanceDetailResponse['status'],
  path: string,
): LensInstanceDetailResponse {
  return {
    lens_instance_id: id,
    status,
    lens_name: 'skinnyWMS',
    lens_params: { local_path: path },
    ports: [54300],
  }
}

async function openPopover() {
  const screen = await renderWithRouter(
    <StatusDetailsPopover extra={<LensServersSection />}>
      <span>Open Status</span>
    </StatusDetailsPopover>,
  )
  await screen.getByText('Open Status').click()
  await expect.element(screen.getByText('API server')).toBeVisible()
  return screen
}

describe('LensServersSection', () => {
  beforeEach(() => {
    resetLensState()
    resetWmsState()
  })

  it('stays hidden while no WMS server runs', async () => {
    injectMockLens(lens('gone', 'terminated', '/data/old'))
    const screen = await openPopover()
    await expect
      .element(screen.getByText('WMS servers'))
      .not.toBeInTheDocument()
  })

  it('lists live servers with their capabilities, URL and Stop', async () => {
    injectMockLens(lens('lens-1', 'running', '/data/output/forecast-a'))
    registerMockWmsServer('lens-1', {
      layers: [
        { name: '2t', title: '2 metre temperature' },
        { name: 'msl', title: 'Mean sea level pressure' },
      ],
    })
    injectMockLens(lens('lens-2', 'starting', '/data/output/forecast-b'))
    const screen = await openPopover()

    await expect.element(screen.getByText('WMS servers')).toBeVisible()
    await expect.element(screen.getByText('2 running')).toBeVisible()
    await expect.element(screen.getByText('forecast-a')).toBeVisible()
    await expect.element(screen.getByText('Starting')).toBeVisible()
    // The running server's capabilities fill in its parameter count.
    await expect.element(screen.getByText('2 parameters')).toBeVisible()

    const copy = screen.getByRole('button', { name: 'Copy WMS URL' })
    await expect.element(copy.nth(0)).not.toHaveAttribute('aria-disabled')
    await expect.element(copy.nth(1)).toHaveAttribute('aria-disabled', 'true')

    await screen
      .getByRole('button', { name: 'Stop WMS server' })
      .first()
      .click()
    await expect
      .poll(() => listMockLenses().map((l) => l.lens_instance_id))
      .toEqual(['lens-2'])
  })
})
