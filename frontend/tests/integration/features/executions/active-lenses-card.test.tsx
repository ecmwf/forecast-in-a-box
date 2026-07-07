/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * ActiveLensesCard Integration Tests
 *
 * Renders the running-lens list against the MSW lens handlers:
 * - hidden when no lenses exist
 * - running instances show status, port, path with enabled actions
 * - non-running instances keep Open/Copy disabled
 * - Stop removes the instance from the list
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import {
  injectMockLens,
  listMockLenses,
  resetLensState,
} from '@tests/../mocks/data/lens.data'
import { ActiveLensesCard } from '@/features/executions/components/ActiveLensesCard'
import { useComparisonStore } from '@/features/compare/stores/comparisonStore'
import i18n from '@/lib/i18n'

async function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ActiveLensesCard />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetLensState()
})

describe('ActiveLensesCard', () => {
  it('renders nothing when no lenses are active', async () => {
    const screen = await renderCard()
    // Give the list query a tick to resolve to [].
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByText('Active lenses').elements()).toHaveLength(0)
  })

  it('lists a running lens with its port and path, actions enabled', async () => {
    injectMockLens({
      lens_instance_id: 'lens-running',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/out/run-1.grib2' },
      ports: [54321],
    })
    const screen = await renderCard()

    await expect.element(screen.getByText('skinnyWMS')).toBeVisible()
    await expect.element(screen.getByText(':54321')).toBeVisible()
    await expect
      .element(screen.getByText('/data/out/run-1.grib2'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^open/i }))
      .toBeEnabled()
  })

  it('keeps Open and Copy disabled while a lens is still starting', async () => {
    injectMockLens({
      lens_instance_id: 'lens-starting',
      status: 'starting',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/out/run-2.grib2' },
      ports: [],
    })
    const screen = await renderCard()

    await expect.element(screen.getByText('starting')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^open/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: /copy wms url/i }))
      .toBeDisabled()
  })

  it('adds a path-matched lens to the comparison basket as its stored output', async () => {
    // job-completed-001's task-out-grib marker payload resolves to this path.
    injectMockLens({
      lens_instance_id: 'lens-matched',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/output/job-completed-001_1' },
      ports: [54501],
    })
    const screen = await renderCard()

    const addButton = screen.getByRole('button', {
      name: /add to comparison/i,
    })
    // Enabled once the path index resolved the marker payloads.
    await expect.element(addButton).toBeEnabled()
    await addButton.click()

    expect(useComparisonStore.getState().entries).toEqual([
      expect.objectContaining({
        kind: 'output',
        jobId: 'job-completed-001',
        taskId: 'task-out-grib',
      }),
    ])
  })

  it('keeps Add to comparison disabled for lenses with unmatched paths', async () => {
    injectMockLens({
      lens_instance_id: 'lens-unmatched',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/somewhere/else' },
      ports: [54502],
    })
    const screen = await renderCard()

    await expect.element(screen.getByText(':54502')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /add to comparison/i }))
      .toBeDisabled()
  })

  it('stops an instance via the Stop action and drops it from the list', async () => {
    injectMockLens({
      lens_instance_id: 'lens-to-stop',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/out/run-3.grib2' },
      ports: [54400],
    })
    const screen = await renderCard()

    await expect.element(screen.getByText(':54400')).toBeVisible()
    await screen.getByRole('button', { name: /^stop$/i }).click()

    await expect.element(screen.getByText(':54400')).not.toBeInTheDocument()
    expect(listMockLenses()).toHaveLength(0)
  })
})
