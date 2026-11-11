/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Mutating tests run last: MSW artifact state persists within the file. */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HttpResponse, http } from 'msw'
import { QueryClient } from '@tanstack/react-query'
import { worker } from '@tests/test-extend'
import { renderWithRouter } from '@tests/utils/render'
import { failNextDownloadPoll } from '../../../../mocks/handlers/artifacts.handlers'
import { API_ENDPOINTS } from '@/api/endpoints'
import { resetDownloadState } from '@/api/hooks/useArtifacts'
import { Route } from '@/routes/_authenticated/admin/artifacts.index'
import { useUiStore } from '@/stores/uiStore'
import { useActivityStore } from '@/stores/activityStore'
import { useActivityCollector } from '@/hooks/useActivityCollector'

const ArtifactsPage = Route.options.component!

async function renderPage() {
  const screen = await renderWithRouter(<ArtifactsPage />)
  await expect.element(screen.getByText('AIFS Single MSE 1.1')).toBeVisible()
  return screen
}

type Screen = Awaited<ReturnType<typeof renderPage>>

const segment = (screen: Screen, name: RegExp) =>
  screen.getByRole('radio', { name })

describe('Models page', () => {
  // No app CSS: pin the dialog above its backdrop.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="alert-dialog-content"]{position:fixed;top:0;z-index:50}'
    document.head.appendChild(style)
  })

  // Download polls outlive a test.
  afterEach(() => resetDownloadState())

  beforeEach(() => {
    localStorage.clear()
    useUiStore.getState().setArtifactsViewMode('table')
    useUiStore.getState().setArtifactsSort({ key: 'name', dir: 'asc' })
  })

  it('lists downloaded and available models together, with counts', async () => {
    const screen = await renderPage()

    await expect
      .element(screen.getByText('AIFS Single', { exact: true }))
      .toBeVisible()
    await expect.element(segment(screen, /^All\s*4$/)).toBeChecked()
    await expect.element(segment(screen, /^Downloaded\s*2$/)).toBeVisible()
    await expect.element(segment(screen, /^Available\s*2$/)).toBeVisible()
  })

  it('links each model name to its detail page', async () => {
    const screen = await renderPage()
    await expect
      .element(screen.getByRole('link', { name: 'AIFS Single MSE 1.1' }))
      .toHaveAttribute(
        'href',
        '/admin/artifacts/ecmwf--aifs-single-mse-1.1_w_sdpa',
      )
  })

  it('narrows the list by status segment', async () => {
    const screen = await renderPage()

    await segment(screen, /^Downloaded/).click()
    await expect
      .element(screen.getByText('AIFS Single MSE 1.1'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('AIFS ENS CRPS 1.0')).toBeVisible()
  })

  it('sorts by a column header, reversing on a second click', async () => {
    const screen = await renderPage()
    const rowNames = () =>
      screen
        .getByRole('heading', { level: 4 })
        .all()
        .map((h) => h.element().textContent)

    await screen.getByRole('button', { name: /^Size/ }).click()
    await expect
      .poll(rowNames)
      .toEqual([
        'AIFS ENS',
        'AIFS Single',
        'AIFS Single MSE 1.1',
        'AIFS ENS CRPS 1.0',
      ])
    await screen.getByRole('button', { name: /^Size/ }).click()
    await expect.poll(() => rowNames()[0]).toBe('AIFS ENS CRPS 1.0')
    expect(useUiStore.getState().artifactsSort).toEqual({
      key: 'size',
      dir: 'asc',
    })
  })

  const overview = (
    id: string,
    name: string,
    compatible: boolean,
    available = false,
  ) => ({
    composite_id: { artifact_store_id: 'ecmwf', artifact_local_id: id },
    display_name: name,
    display_author: 'ECMWF',
    disk_size_bytes: 1_000_000,
    supported_platforms: ['linux'],
    tags: {},
    is_available: available,
    is_locally_compatible: compatible,
    local_compatibility_detail: compatible ? null : 'No GPU on this host.',
  })
  const listTwo = () =>
    worker.use(
      http.get(API_ENDPOINTS.artifacts.listModels, () =>
        HttpResponse.json([
          overview('aifs-ens-v0.3.0', 'AIFS ENS', false),
          overview('aifs-single-mse-1.1_w_sdpa', 'AIFS Single MSE 1.1', true),
        ]),
      ),
    )

  const rowNames = (screen: Screen) =>
    screen
      .getByRole('heading', { level: 4 })
      .all()
      .map((h) => h.element().textContent)

  it('shows maturity in its own column and sorts by it', async () => {
    const screen = await renderPage()

    // A column value, not a "maturity: demo" chip.
    await expect
      .element(screen.getByText('demo', { exact: true }))
      .toBeVisible()
    expect(screen.getByText(/^maturity:/).elements()).toHaveLength(0)

    await screen.getByRole('button', { name: /^Maturity/ }).click()
    // Models without a maturity last, by name.
    await expect
      .poll(() => rowNames(screen))
      .toEqual([
        'AIFS Single',
        'AIFS ENS CRPS 1.0',
        'AIFS ENS',
        'AIFS Single MSE 1.1',
      ])
  })

  it('filters by maturity, narrowing the availability counts', async () => {
    const screen = await renderPage()

    await screen.getByLabelText('Filter by maturity').click()
    await screen.getByRole('option', { name: 'Demo' }).click()
    await expect.poll(() => rowNames(screen)).toEqual(['AIFS Single'])
    await expect.element(segment(screen, /^All\s*1$/)).toBeChecked()
    await expect.element(segment(screen, /^Available\s*0$/)).toBeVisible()
  })

  const tagged = (id: string, tags: Record<string, string | null>) => ({
    ...overview(id, id.toUpperCase(), true),
    tags,
  })
  const listTagged = (models: Array<ReturnType<typeof tagged>>) =>
    worker.use(
      http.get(API_ENDPOINTS.artifacts.listModels, () =>
        HttpResponse.json(models),
      ),
    )
  const maturityOptions = (screen: Screen) =>
    screen
      .getByRole('option')
      .all()
      .map((o) => o.element().textContent)

  it('offers one filter entry per maturity, whatever its case', async () => {
    listTagged([
      tagged('a', { maturity: 'Demo' }),
      tagged('b', { status: ' demo ' }),
      tagged('c', { maturity: 'operational' }),
      tagged('d', { maturity: '' }),
    ])
    const screen = await renderWithRouter(<ArtifactsPage />)

    await screen.getByLabelText('Filter by maturity').click()
    await expect
      .poll(() => maturityOptions(screen))
      .toEqual(['All maturities', 'Demo', 'Operational'])
    await screen.getByRole('option', { name: 'Demo' }).click()
    await expect.poll(() => rowNames(screen)).toEqual(['A', 'B'])
  })

  it('stops filtering by a maturity that leaves the catalogue', async () => {
    listTagged([
      tagged('a', { maturity: 'demo' }),
      tagged('b', { maturity: 'operational' }),
    ])
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    })
    const screen = await renderWithRouter(<ArtifactsPage />, { queryClient })
    await screen.getByLabelText('Filter by maturity').click()
    await screen.getByRole('option', { name: 'Operational' }).click()
    await expect.poll(() => rowNames(screen)).toEqual(['B'])

    listTagged([
      tagged('a', { maturity: 'demo' }),
      tagged('b', { maturity: 'experimental' }),
      tagged('c', {}),
    ])
    await queryClient.invalidateQueries()
    await expect.poll(() => rowNames(screen)).toEqual(['A', 'B', 'C'])
    // The closed list stays mounted; the first match is the trigger's value.
    await expect
      .element(screen.getByText('All maturities', { exact: true }).first())
      .toBeVisible()
  })

  it('states availability as text, with the reason on hover', async () => {
    listTwo()
    const screen = await renderPage()

    const incompatible = screen.getByText('Incompatible', { exact: true })
    await expect.element(incompatible).toBeVisible()
    await expect
      .element(screen.getByText('Available', { exact: true }).last())
      .toBeVisible()
    // Platform and "Compatible" chips are gone from the rows.
    expect(screen.getByText('linux', { exact: true }).elements()).toHaveLength(
      0,
    )
    expect(
      screen.getByText('Compatible', { exact: true }).elements(),
    ).toHaveLength(0)

    await incompatible.hover()
    await expect.element(screen.getByText('No GPU on this host.')).toBeVisible()
    await screen.getByText('Available', { exact: true }).last().hover()
    await expect
      .element(screen.getByText(/^Not on this machine yet/))
      .toBeVisible()

    // Downloadable before incompatible.
    await screen.getByRole('button', { name: /^Availability/ }).click()
    await expect
      .poll(() => rowNames(screen))
      .toEqual(['AIFS Single MSE 1.1', 'AIFS ENS'])
  })

  it('shows a downloaded model that cannot run here as incompatible', async () => {
    worker.use(
      http.get(API_ENDPOINTS.artifacts.listModels, () =>
        HttpResponse.json([
          overview('aifs-ens-v0.3.0', 'AIFS ENS', false, true),
          overview('aifs-single-v1.0', 'AIFS Single', true, true),
          overview('aifs-single-mse-1.1_w_sdpa', 'AIFS Single MSE 1.1', true),
        ]),
      ),
    )
    const screen = await renderPage()

    const incompatible = screen.getByText('Incompatible', { exact: true })
    await incompatible.hover()
    await expect
      .element(
        screen.getByText(
          "Downloaded, but can't run on this machine: No GPU on this host.",
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Downloaded', { exact: true }).last())
      .toBeVisible()

    // Usable downloads first, the one that can't run last.
    await screen.getByRole('button', { name: /^Availability/ }).click()
    await expect
      .poll(() => rowNames(screen))
      .toEqual(['AIFS Single', 'AIFS Single MSE 1.1', 'AIFS ENS'])
  })

  it('tells same-name variants apart by id, and finds them by it', async () => {
    worker.use(
      http.get(API_ENDPOINTS.artifacts.listModels, () =>
        HttpResponse.json([
          overview('aifs-ens-crps-1.0_w_sdpa', 'AIFS ENS CRPS 1.0', true),
          overview(
            'aifs-ens-crps-1.0_w_flash_attn',
            'AIFS ENS CRPS 1.0',
            false,
          ),
        ]),
      ),
    )
    const screen = await renderWithRouter(<ArtifactsPage />)
    const ids = () =>
      screen
        .getByText(/^aifs-ens-crps-1\.0_w_/)
        .all()
        .map((p) => p.element().textContent)

    // One store: local ids, sorted by id within a name.
    await expect
      .poll(ids)
      .toEqual(['aifs-ens-crps-1.0_w_flash_attn', 'aifs-ens-crps-1.0_w_sdpa'])
    await screen.getByPlaceholder('Search models').fill('sdpa')
    await expect.poll(ids).toEqual(['aifs-ens-crps-1.0_w_sdpa'])
  })

  it('blocks incompatible downloads and shows progress in place', async () => {
    listTwo()
    const screen = await renderPage()
    const downloads = screen.getByRole('button', { name: 'Download' })

    await expect.element(downloads.first()).toBeDisabled()
    await downloads.last().click()
    await expect.element(screen.getByText('Downloading').first()).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Cancel' }).elements(),
    ).toHaveLength(0)
  })

  it('keeps a failed download visible and retries it (ecmwf#775)', async () => {
    listTwo()
    failNextDownloadPoll(
      {
        artifact_store_id: 'ecmwf',
        artifact_local_id: 'aifs-single-mse-1.1_w_sdpa',
      },
      'HTTPError(503 Service Unavailable)',
    )
    // The notification centre reports the failure.
    function Collector() {
      useActivityCollector()
      return null
    }
    useActivityStore.setState({ tasks: {}, dismissed: {} })
    const screen = await renderWithRouter(
      <>
        <ArtifactsPage />
        <Collector />
      </>,
    )
    await screen.getByRole('button', { name: 'Download' }).last().click()
    const downloadTask = () =>
      Object.values(useActivityStore.getState().tasks).find(
        (task) => task?.type === 'download',
      )

    const failed = screen.getByText('Download failed')
    await expect.element(failed).toBeVisible()
    await failed.hover()
    await expect
      .element(screen.getByText('HTTPError(503 Service Unavailable)'))
      .toBeVisible()
    const retry = screen.getByRole('button', { name: 'Retry download' })
    await expect.element(retry).toBeVisible()
    await expect.poll(() => downloadTask()?.status).toBe('failed')
    expect(downloadTask()?.description).toContain('HTTPError(503')

    // The click sends retry=true.
    await retry.click()
    await expect.element(screen.getByText('Downloading').first()).toBeVisible()
    expect(screen.getByText('Download failed').elements()).toHaveLength(0)
    await expect.poll(() => downloadTask()?.status).toBe('active')
  })

  // Mutating test: keep last.
  it('keeps a deleted model in the Downloaded view, now available', async () => {
    const screen = await renderPage()

    await segment(screen, /^Downloaded/).click()
    await screen
      .getByRole('button', { name: 'Delete', exact: true })
      .first()
      .click()
    await screen
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect.element(segment(screen, /^Downloaded\s*1$/)).toBeVisible()
    // Still listed although it no longer matches "Downloaded".
    await expect.element(screen.getByText('AIFS ENS CRPS 1.0')).toBeVisible()
    await expect.element(screen.getByText('Available')).toBeVisible()
    await expect
      .poll(() => document.querySelectorAll('[data-held]').length)
      .toBe(1)
  })
})
