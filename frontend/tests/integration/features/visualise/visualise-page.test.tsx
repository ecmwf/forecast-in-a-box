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
 * VisualisePage integration tests — against MSW job + lens + WMS handlers:
 * - empty basket renders the source picker as the page body
 * - adding sources activates A/B slots and auto-starts lenses
 * - two entries resolving to the SAME directory share ONE lens
 * - a shared URL hydrates unknown refs into the basket; invalid refs are
 *   stripped
 * - Stop lens servers stops them and pauses auto-start (no instant
 *   restart)
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { z } from 'zod'
import {
  injectMockExecution,
  resetJobsState,
  secondGribRunExecution,
} from '@tests/../mocks/data/job.data'
import {
  failMockLens,
  injectMockLens,
  listMockLenses,
  resetLensState,
  stopMockLens,
} from '@tests/../mocks/data/lens.data'
import {
  registerMockWmsServer,
  wmsCapabilitiesRequestCount,
} from '@tests/../mocks/data/wms.data'
import { VisualisePage } from '@/features/visualise/components/VisualisePage'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import i18n from '@/lib/i18n'

const searchSchema = z.object({
  a: z.string().optional(),
  b: z.string().optional(),
  mode: z.enum(['swipe', 'side', 'flicker', 'spy', 'blend']).optional(),
})

function renderVisualisePage(search = '') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  // Layout route matching the real _authenticated prefix so
  // getRouteApi('/_authenticated/compare') resolves.
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => <Outlet />,
  })
  const visualiseRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/visualise',
    validateSearch: searchSchema,
    component: VisualisePage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([visualiseRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [`/visualise${search}`] }),
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const RUN_A = {
  kind: 'output',
  jobId: 'job-completed-001',
  taskId: 'task-out-grib',
  blockId: 'block_sink_1',
  runName: 'Run A',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
} as const

const RUN_B = {
  kind: 'output',
  jobId: 'job-grib-b-008',
  taskId: 'task-out-grib-b',
  blockId: 'block_sink_1',
  runName: 'Run B',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
} as const

beforeEach(() => {
  resetJobsState()
  injectMockExecution(secondGribRunExecution)
  resetLensState()
  // Mock lenses allocate ports from 54300 — serve WMS on the first few so
  // panels that reach `running` can load capabilities.
  for (let port = 54300; port < 54306; port++) {
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
  }
})

describe('VisualisePage', () => {
  it('renders the source picker as the empty state', async () => {
    const screen = await renderVisualisePage()
    await expect
      .element(screen.getByPlaceholder('Search runs and blocks…'))
      .toBeVisible()
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    // Both seeded GRIB runs offer an Add action; rows are disambiguated
    // by short job id + block.
    await expect
      .element(
        screen.getByRole('button', { name: /add to comparison/i }).first(),
      )
      .toBeVisible()
    await expect.element(screen.getByText(/job-comp/).first()).toBeVisible()
  })

  it('activates two sources as A/B and auto-starts one lens per directory', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    // Chips carry the slot badges (name also appears in panel headers).
    await expect.element(screen.getByText('Run A').first()).toBeVisible()
    await expect.element(screen.getByText('Run B').first()).toBeVisible()

    // Each panel resolves its dir and starts its own lens.
    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(2)
    const paths = listMockLenses()
      .map((l) => l.lens_params.local_path)
      .sort()
    expect(paths).toEqual([
      '/data/output/job-completed-001_1',
      '/data/output/job-grib-b-008_1',
    ])
  })

  it('starts exactly one lens when both sources resolve to the same directory', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry({
      kind: 'path',
      path: '/data/output/job-completed-001_1',
      label: 'Same dir',
    })
    const screen = await renderVisualisePage()

    await expect.element(screen.getByText('Same dir').first()).toBeVisible()
    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(1)
    // Give any duplicate-start race a beat to (wrongly) materialize.
    await new Promise((r) => setTimeout(r, 1500))
    expect(listMockLenses()).toHaveLength(1)
  })

  it('assigns slots via the slot bar and swaps them', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    // Normalization fills A/B from basket order.
    const pickerA = screen.getByLabelText('Source for slot A')
    const pickerB = screen.getByLabelText('Source for slot B')
    await expect.element(pickerA).toHaveTextContent('Run A')
    await expect.element(pickerB).toHaveTextContent('Run B')

    await screen.getByRole('button', { name: 'Swap A and B' }).click()
    await expect.element(pickerA).toHaveTextContent('Run B')
    await expect.element(pickerB).toHaveTextContent('Run A')
  })

  it('runs the viewer solo with a single source', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    const screen = await renderVisualisePage()

    // A auto-starts and the viewer mounts without a B: no mode switcher
    // (adding B is the header's "Add source" job), and B is unassigned.
    await expect
      .element(screen.getByText(/display is static/), { timeout: 8000 })
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Swipe' }).elements(),
    ).toHaveLength(0)
    await expect
      .element(screen.getByLabelText('Source for slot B'))
      .toHaveTextContent('Pick a source…')
  })

  it('offers Stop only for stray lenses (no basket entry)', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    injectMockLens({
      lens_instance_id: 'lens-stray-1',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/output/foreign-dir' },
      ports: [54305],
    })
    // Failed registry records must not surface as "running" rows.
    injectMockLens({
      lens_instance_id: 'lens-corpse-1',
      status: 'failed',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/output/corpse-dir' },
      ports: [],
    })
    const screen = await renderVisualisePage()
    await expect
      .poll(() => listMockLenses().filter((l) => l.status === 'running'), {
        timeout: 8000,
      })
      .toHaveLength(2)

    await screen.getByRole('button', { name: 'Manage sources' }).click()
    expect(screen.getByText('/data/output/corpse-dir').elements()).toHaveLength(
      0,
    )
    const stopButtons = screen.getByRole('button', {
      name: 'Stop lens server',
    })
    // Only the stray row gets a Stop — A's lens stops via source removal.
    await expect.element(stopButtons).toBeVisible()
    expect(stopButtons.elements()).toHaveLength(1)
    ;(stopButtons.element() as HTMLElement).click()
    await expect
      .poll(() => listMockLenses().filter((l) => l.status === 'running'), {
        timeout: 5000,
      })
      .toHaveLength(1)
    expect(
      listMockLenses()
        .filter((l) => l.status === 'running')
        .map((l) => l.lens_params.local_path),
    ).toEqual(['/data/output/job-completed-001_1'])
  })

  it('removing a source stops its now-orphaned lens', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()
    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(2)

    // Take B out of the view, then out of the basket (collected chip).
    await screen.getByRole('button', { name: 'Single view' }).click()
    await screen.getByRole('button', { name: 'Manage sources' }).click()
    // Native click: the unstyled dialog's inert backdrop confuses
    // Playwright hit-testing (see the stop-row test above).
    const removeB = screen.getByRole('button', { name: /Remove Run B/ })
    await expect.element(removeB).toBeVisible()
    ;(removeB.element() as HTMLElement).click()

    await expect
      .poll(() => listMockLenses().filter((l) => l.status === 'running'), {
        timeout: 5000,
      })
      .toHaveLength(1)
    expect(
      listMockLenses()
        .filter((l) => l.status === 'running')
        .map((l) => l.lens_params.local_path),
    ).toEqual(['/data/output/job-completed-001_1'])
  })

  it(
    'recovers when a serving lens is stopped elsewhere',
    { timeout: 40000 },
    async () => {
      useComparisonStore.getState().addEntry(RUN_A)
      const screen = await renderVisualisePage()
      await expect
        .poll(() => listMockLenses(), { timeout: 8000 })
        .toHaveLength(1)
      await expect
        .element(screen.getByText('Compare…').first(), { timeout: 8000 })
        .not.toBeInTheDocument()
      const firstId = listMockLenses()[0].lens_instance_id

      // Killed behind the page's back (run-list card, another tab).
      stopMockLens(firstId)
      // The running-liveness poll surfaces the 404; auto-start revives.
      await expect
        .poll(
          () => listMockLenses().filter((l) => l.lens_instance_id !== firstId),
          { timeout: 25000 },
        )
        .toHaveLength(1)
    },
  )

  it(
    'revives a lens the backend marks failed after it served',
    { timeout: 40000 },
    async () => {
      useComparisonStore.getState().addEntry(RUN_A)
      const screen = await renderVisualisePage()
      await expect
        .poll(() => listMockLenses(), { timeout: 8000 })
        .toHaveLength(1)
      // Wait until the lens actually SERVES (viewer mounted) and the
      // status poll has observed `running` — a lens that never served
      // must keep the honest failed phase instead of reviving.
      await expect
        .element(screen.getByText(/display is static/), { timeout: 10000 })
        .toBeVisible()
      await new Promise((r) => setTimeout(r, 2200))
      const firstId = listMockLenses()[0].lens_instance_id

      // External stop on the real backend keeps the record, status failed.
      failMockLens(firstId)
      // Revival starts a fresh instance AND purges the failed record.
      await expect
        .poll(
          () => {
            const lensesNow = listMockLenses()
            return (
              lensesNow.length === 1 &&
              lensesNow[0].status === 'running' &&
              lensesNow[0].lens_instance_id !== firstId
            )
          },
          { timeout: 25000 },
        )
        .toBe(true)
    },
  )

  it('Clear all asks for confirmation, then empties basket and URL pair', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    await expect
      .element(screen.getByLabelText('Source for slot B'))
      .toHaveTextContent('Run B')

    // Cancel keeps everything.
    await screen.getByRole('button', { name: 'Clear all' }).click()
    const dialog = screen.getByRole('alertdialog')
    await expect.element(dialog).toBeVisible()
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    ;(cancel.element() as HTMLElement).click()
    expect(useComparisonStore.getState().entries).toHaveLength(2)

    // Confirm clears.
    await screen.getByRole('button', { name: 'Clear all' }).click()
    const confirm = screen
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Clear all' })
    await expect.element(confirm).toBeVisible()
    ;(confirm.element() as HTMLElement).click()
    // Hydration must not resurrect the active pair from the URL refs.
    await expect
      .element(screen.getByPlaceholder('Search runs and blocks…'))
      .toBeVisible()
    await new Promise((r) => setTimeout(r, 1200))
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })

  it("badges A's entry in the B picker; picking it self-compares", async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    const screen = await renderVisualisePage()

    await screen.getByLabelText('Source for slot B').click()
    await expect
      .element(screen.getByTitle('Currently source A'))
      .toBeInTheDocument()
    await screen.getByRole('option', { name: /Run A/ }).click()
    await expect
      .element(screen.getByLabelText('Source for slot B'))
      .toHaveTextContent('Run A')
  })

  it('the X clears B and materialization does not re-fill it', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    const pickerB = screen.getByLabelText('Source for slot B')
    await expect.element(pickerB).toHaveTextContent('Run B')

    await screen.getByRole('button', { name: 'Single view' }).click()
    await expect.element(pickerB).toHaveTextContent('Pick a source…')
    // The `b=off` sentinel holds against the auto-fill effect, and the X
    // is gone while B is empty.
    await new Promise((r) => setTimeout(r, 1200))
    await expect.element(pickerB).toHaveTextContent('Pick a source…')
    expect(
      screen.getByRole('button', { name: 'Single view' }).elements(),
    ).toHaveLength(0)
  })

  it('the X ejects an external-WMS B (regression: fake Select items)', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry({
      kind: 'wms',
      url: 'http://localhost:54390/wms?',
      label: 'maps.dwd.de',
    })
    registerMockWmsServer(54390, {
      layers: [{ name: 'dwd:layer', title: 'DWD layer' }],
    })
    const screen = await renderVisualisePage()

    const pickerB = screen.getByLabelText('Source for slot B')
    await expect.element(pickerB).toHaveTextContent('maps.dwd.de')
    await screen.getByRole('button', { name: 'Single view' }).click()
    await expect.element(pickerB).toHaveTextContent('Pick a source…')
    await new Promise((r) => setTimeout(r, 1200))
    await expect.element(pickerB).toHaveTextContent('Pick a source…')
  })

  it('identifies sources in the slot dropdown with kind and id', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    await screen.getByLabelText('Source for slot B').click()
    // Two-line items: name plus a kind badge and the short job id.
    const optionA = screen.getByRole('option', { name: /Run A/ })
    await expect.element(optionA).toBeVisible()
    await expect
      .element(optionA.getByText('Run', { exact: true }))
      .toBeVisible()
    await expect.element(optionA.getByText('job-comp')).toBeVisible()
  })

  it('allows the same source in both slots', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    const pickerA = screen.getByLabelText('Source for slot A')
    const pickerB = screen.getByLabelText('Source for slot B')
    await expect.element(pickerB).toHaveTextContent('Run B')

    // Picking A's source for slot B must NOT swap — same-source compare
    // (different layers of one run) is a real workflow.
    await pickerB.click()
    await screen.getByRole('option', { name: 'Run A' }).click()
    await expect.element(pickerA).toHaveTextContent('Run A')
    await expect.element(pickerB).toHaveTextContent('Run A')
  })

  it('hydrates basket entries from a shared URL', async () => {
    const a = `run:${RUN_A.jobId}~${RUN_A.taskId}`
    const b = `run:${RUN_B.jobId}~${RUN_B.taskId}`
    await renderVisualisePage(
      `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    )

    await expect
      .poll(() => useComparisonStore.getState().entries, { timeout: 5000 })
      .toHaveLength(2)
    const kinds = useComparisonStore
      .getState()
      .entries.map((e) => e.kind === 'output' && e.jobId)
    expect(kinds).toEqual(['job-completed-001', 'job-grib-b-008'])
  })

  it('strips invalid refs from a shared URL instead of wedging', async () => {
    const screen = await renderVisualisePage('?a=bogus%3Anope')
    // The invalid ref is dropped; page falls back to the empty state.
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })

  it('holds external WMS links behind a confirm; Add connects', async () => {
    const port = 54390
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent(`wms:http://localhost:${port}`)}`,
    )

    await expect
      .element(screen.getByText('Connect to external WMS server?'))
      .toBeVisible()
    // Held: nothing persisted, the server not contacted — a crafted link
    // must not drive-by-connect a victim's browser.
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(wmsCapabilitiesRequestCount(port)).toBe(0)

    const add = screen.getByRole('button', { name: 'Add and connect' })
    ;(add.element() as HTMLElement).click()
    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    await expect
      .poll(() => wmsCapabilitiesRequestCount(port), { timeout: 8000 })
      .toBeGreaterThan(0)
  })

  it('Ignore declines the external link without any contact', async () => {
    const port = 54391
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent(`wms:http://localhost:${port}`)}`,
    )

    await expect
      .element(screen.getByText('Connect to external WMS server?'))
      .toBeVisible()
    const ignore = screen.getByRole('button', { name: 'Ignore' })
    ;(ignore.element() as HTMLElement).click()
    // Stripped: back to the empty state, never contacted or persisted.
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(wmsCapabilitiesRequestCount(port)).toBe(0)
  })

  it('rejects non-http(s) schemes in shared wms refs outright', async () => {
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent('wms:javascript:alert(1)')}`,
    )
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(
      screen.getByText('Connect to external WMS server?').elements(),
    ).toHaveLength(0)
  })
})
