/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, http } from 'msw'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { registerMockWmsServer } from '../../../../mocks/data/wms.data'
import { EcmwfKeyDialog } from '@/features/visualise/components/sources/EcmwfKeyDialog'
import { useEcmwfKeyStore } from '@/stores/ecmwfKeyStore'

const KEY = '8ea0123456789abcdef0123456789abc'

describe('EcmwfKeyDialog', () => {
  // No app stylesheet in browser-mode tests: restore the dialog stacking.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;background:#fff}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    localStorage.clear()
    useEcmwfKeyStore.setState({ key: null, dialogOpen: true })
    // Curated hosts pass through to the network unless mocked.
    registerMockWmsServer('eccharts.ecmwf.int', {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
  })

  it('stores a key the ECMWF server accepts and closes', async () => {
    const screen = await renderWithProviders(<EcmwfKeyDialog />)
    await screen.getByLabelText('API key').fill(KEY)
    await screen.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => useEcmwfKeyStore.getState().key).toBe(KEY)
    expect(useEcmwfKeyStore.getState().dialogOpen).toBe(false)
  })

  it('reports a rejected key and keeps the dialog open', async () => {
    worker.use(
      http.get(
        'https://eccharts.ecmwf.int/wms/',
        () => new HttpResponse(null, { status: 403 }),
      ),
    )
    const screen = await renderWithProviders(<EcmwfKeyDialog />)
    await screen.getByLabelText('API key').fill('bad-key')
    await screen.getByRole('button', { name: 'Save' }).click()
    await expect
      .element(screen.getByText('The ECMWF WMS server rejected this key.'))
      .toBeVisible()
    expect(useEcmwfKeyStore.getState().key).toBeNull()
    expect(useEcmwfKeyStore.getState().dialogOpen).toBe(true)
  })

  it('reveals and hides the typed key', async () => {
    const screen = await renderWithProviders(<EcmwfKeyDialog />)
    const input = screen.getByLabelText('API key')
    await input.fill(KEY)
    await expect.element(input).toHaveAttribute('type', 'password')
    await screen.getByRole('button', { name: 'Show key' }).click()
    await expect.element(input).toHaveAttribute('type', 'text')
    await screen.getByRole('button', { name: 'Hide key' }).click()
    await expect.element(input).toHaveAttribute('type', 'password')
  })

  it('removes the active key', async () => {
    useEcmwfKeyStore.setState({ key: KEY, dialogOpen: true })
    const screen = await renderWithProviders(<EcmwfKeyDialog />)
    await expect.element(screen.getByText('Key active')).toBeVisible()
    await expect.element(screen.getByText('ending in …9abc')).toBeVisible()
    await expect.element(screen.getByLabelText('Replace key')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Replace' }))
      .toBeDisabled()
    await screen.getByRole('button', { name: 'Remove key' }).click()
    expect(useEcmwfKeyStore.getState().key).toBeNull()
  })
})
