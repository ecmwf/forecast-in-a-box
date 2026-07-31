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

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import {
  injectMockExecution,
  resetJobsState,
  secondGribRunExecution,
} from '@tests/../mocks/data/job.data'
import {
  failMockLens,
  failNextLensStatusPolls,
  injectMockLens,
  listMockLenses,
  pendingLensStatusFailures,
  resetLensState,
  setLensListOutage,
  stopMockLens,
} from '@tests/../mocks/data/lens.data'
import {
  registerMockWmsServer,
  wmsCapabilitiesRequestCount,
} from '@tests/../mocks/data/wms.data'
import type * as GeoViewerModule from '@/features/viewer/geo/GeoViewer'
import { Route as VisualiseRoute } from '@/routes/_authenticated/visualise'
import { VisualisePage } from '@/features/visualise/components/VisualisePage'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import i18n from '@/lib/i18n'

// While armed the viewer throws on render (error-boundary tests) — a
// one-shot throw would be absorbed by React's concurrent-recovery
// re-render and never reach the boundary; tests disarm before Retry.
const viewerCrash = vi.hoisted(() => ({ armed: false }))
vi.mock('@/features/viewer/geo/GeoViewer', async (importOriginal) => {
  const actual = await importOriginal<typeof GeoViewerModule>()
  return {
    ...actual,
    GeoViewer: (props: Parameters<typeof actual.GeoViewer>[0]) => {
      if (viewerCrash.armed) throw new Error('viewer exploded')
      return <actual.GeoViewer {...props} />
    },
  }
})

// The real route's schema — the harness must not drift from production
// search validation (view-state params, `.catch` resilience).
const searchSchema = VisualiseRoute.options.validateSearch

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
  viewerCrash.armed = false
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

  it('degrades malformed view-state params instead of failing the route', async () => {
    const screen = await renderVisualisePage(
      '?mode=bogus&t=notanumber&cam=1,2&ul=nope&tl=weird',
    )
    // Page shell alive, empty state rendered — every bad param dropped.
    await expect
      .element(screen.getByPlaceholder('Search runs and blocks…'))
      .toBeVisible()
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

  it('swapping hands a healthy source to a slot whose start had failed', async () => {
    // Every start rejects; B is served by a pre-existing lens, so only
    // A's auto-start fails.
    resetLensState({ skinnyWmsInstalled: false })
    injectMockLens({
      lens_instance_id: 'lens-b-live',
      status: 'running',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: '/data/output/job-grib-b-008_1' },
      ports: [54300],
    })
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()

    // A failed, B running — lifecycle panels, no viewer.
    await expect
      .element(screen.getByRole('button', { name: 'Retry' }), {
        timeout: 8000,
      })
      .toBeVisible()
    await expect.element(screen.getByText(/Serving/)).toBeVisible()

    await screen.getByRole('button', { name: 'Swap A and B' }).click()

    // Healthy source now in A — the viewer must mount; the old entry's
    // start failure must not stick.
    await expect
      .element(screen.getByText(/display is static/), { timeout: 8000 })
      .toBeVisible()
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

  it('gates local sources when SkinnyWMS is missing; external WMS stays', async () => {
    resetLensState({ skinnyWmsInstalled: false })
    const screen = await renderVisualisePage()

    const add = screen
      .getByRole('button', { name: /add to comparison/i })
      .first()
    await expect.element(add).toBeDisabled()
    await expect
      .element(screen.getByLabelText('GRIB directory on this host'))
      .toBeDisabled()
    await expect
      .element(screen.getByText(/SkinnyWMS is not installed/).first())
      .toBeVisible()
    await expect
      .element(screen.getByLabelText('External WMS server'))
      .toBeEnabled()
  })

  it('a viewer crash keeps the page shell alive; Retry recovers', async () => {
    viewerCrash.armed = true
    useComparisonStore.getState().addEntry(RUN_A)
    const screen = await renderVisualisePage()

    await expect
      .element(screen.getByText('The map viewer failed'), { timeout: 8000 })
      .toBeVisible()
    await expect.element(screen.getByText('viewer exploded')).toBeVisible()
    // The shell survives: slot bar and source management stay usable.
    await expect
      .element(screen.getByLabelText('Source for slot A'))
      .toBeVisible()

    viewerCrash.armed = false
    await screen.getByRole('button', { name: 'Retry' }).click()
    await expect
      .element(screen.getByText(/display is static/), { timeout: 8000 })
      .toBeVisible()
  })

  it('surfaces a lens-registry outage with Retry instead of spinning', async () => {
    setLensListOutage(true)
    useComparisonStore.getState().addEntry(RUN_A)
    const screen = await renderVisualisePage()

    const retry = screen.getByRole('button', { name: 'Retry' })
    await expect.element(retry).toBeVisible()
    expect(listMockLenses()).toHaveLength(0)

    setLensListOutage(false)
    await retry.click()
    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(1)
    await expect
      .element(screen.getByText(/display is static/), { timeout: 8000 })
      .toBeVisible()
  })

  it(
    'keeps the running viewer through a transient status-poll outage',
    { timeout: 60000 },
    async () => {
      useComparisonStore.getState().addEntry(RUN_A)
      const screen = await renderVisualisePage()
      await expect
        .element(screen.getByText(/display is static/), { timeout: 8000 })
        .toBeVisible()

      // 3 consecutive 5xx: one fully errored poll cycle (attempt + 2 retries).
      failNextLensStatusPolls(3)
      await expect
        .poll(() => pendingLensStatusFailures(), {
          timeout: 30000,
          interval: 500,
        })
        .toBe(0)
      await new Promise((r) => setTimeout(r, 800))

      // Stale-running keeps the viewer mounted; no failure UI, no remount.
      await expect.element(screen.getByText(/display is static/)).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Retry' }).elements(),
      ).toHaveLength(0)
    },
  )

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

  it('removing ACTIVE A promotes B into the vacated slot', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()
    await expect
      .element(screen.getByLabelText('Source for slot A'))
      .toHaveTextContent('Run A')

    await screen.getByRole('button', { name: 'Manage sources' }).click()
    const removeA = screen.getByRole('button', { name: /Remove Run A/ })
    await expect.element(removeA).toBeVisible()
    ;(removeA.element() as HTMLElement).click()
    ;(
      screen.getByRole('button', { name: 'Close' }).element() as HTMLElement
    ).click()

    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    await expect
      .element(screen.getByLabelText('Source for slot A'))
      .toHaveTextContent('Run B')
    // The removed ref left the URL — hydration must not resurrect it.
    await new Promise((r) => setTimeout(r, 1200))
    expect(useComparisonStore.getState().entries).toHaveLength(1)
  })

  it('removing ACTIVE B keeps A; a replacement added later activates', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderVisualisePage()
    await expect
      .element(screen.getByLabelText('Source for slot B'))
      .toHaveTextContent('Run B')

    await screen.getByRole('button', { name: 'Manage sources' }).click()
    const removeB = screen.getByRole('button', { name: /Remove Run B/ })
    await expect.element(removeB).toBeVisible()
    ;(removeB.element() as HTMLElement).click()
    ;(
      screen.getByRole('button', { name: 'Close' }).element() as HTMLElement
    ).click()

    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    await expect
      .element(screen.getByLabelText('Source for slot A'))
      .toHaveTextContent('Run A')
    await new Promise((r) => setTimeout(r, 1200))
    expect(useComparisonStore.getState().entries).toHaveLength(1)

    // The vacated slot must accept a replacement (no dead ref wedging it).
    useComparisonStore.getState().addEntry(RUN_B)
    await expect
      .element(screen.getByLabelText('Source for slot B'))
      .toHaveTextContent('Run B')
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
    // Await the close — the mid-unmount dialog's action also matches 'Clear all'.
    await expect
      .poll(() => screen.getByRole('alertdialog').elements())
      .toHaveLength(0)

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
      .element(screen.getByText('Add sources from this shared link?'))
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
      .element(screen.getByText('Add sources from this shared link?'))
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
      screen.getByText('Add sources from this shared link?').elements(),
    ).toHaveLength(0)
  })

  it('holds host-path links behind a confirm; Add starts the lens', async () => {
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent('path:/data/external-grib')}`,
    )

    await expect
      .element(screen.getByText('Add sources from this shared link?'))
      .toBeVisible()
    // Held: nothing persisted, no lens spawned — a crafted link must not
    // make the backend serve an arbitrary host directory.
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(listMockLenses()).toHaveLength(0)

    const add = screen.getByRole('button', { name: 'Add and connect' })
    ;(add.element() as HTMLElement).click()
    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    expect(useComparisonStore.getState().entries[0]).toMatchObject({
      kind: 'path',
      path: '/data/external-grib',
    })
    await expect
      .poll(
        () =>
          listMockLenses().some(
            (l) => l.lens_params.local_path === '/data/external-grib',
          ),
        { timeout: 8000 },
      )
      .toBe(true)
  })

  it('Ignore declines the host-path link without starting a lens', async () => {
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent('path:/data/external-grib')}`,
    )

    await expect
      .element(screen.getByText('Add sources from this shared link?'))
      .toBeVisible()
    const ignore = screen.getByRole('button', { name: 'Ignore' })
    ;(ignore.element() as HTMLElement).click()
    // Stripped: back to the empty state, nothing persisted or spawned.
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(listMockLenses()).toHaveLength(0)
  })

  it('rejects traversal and relative host-path refs outright', async () => {
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent('path:/data/../etc')}`,
    )
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(listMockLenses()).toHaveLength(0)
    expect(
      screen.getByText('Add sources from this shared link?').elements(),
    ).toHaveLength(0)
  })

  it('strips unknown dir: refs — digests resolve only locally', async () => {
    const screen = await renderVisualisePage('?a=dir%3Adeadbeef')
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(
      screen.getByText('Add sources from this shared link?').elements(),
    ).toHaveLength(0)
  })

  it('strips unknown wmsp: refs — credentialed endpoints never travel', async () => {
    const screen = await renderVisualisePage('?a=wmsp%3Adeadbeef')
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
    expect(
      screen.getByText('Add sources from this shared link?').elements(),
    ).toHaveLength(0)
  })

  it('redacts tokened wms links in the consent dialog; Add keeps the real URL', async () => {
    const port = 54392
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    const url = `http://localhost:${port}/wms?token=supersecret`
    const screen = await renderVisualisePage(
      `?a=${encodeURIComponent(`wms:${url}`)}`,
    )

    await expect
      .element(screen.getByText('Add sources from this shared link?'))
      .toBeVisible()
    await expect.element(screen.getByText(/token=\*\*\*/)).toBeVisible()
    expect(screen.getByText(/supersecret/).elements()).toHaveLength(0)

    const add = screen.getByRole('button', { name: 'Add and connect' })
    ;(add.element() as HTMLElement).click()
    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    expect(useComparisonStore.getState().entries[0]).toMatchObject({
      kind: 'wms',
      url,
    })
  })
})
