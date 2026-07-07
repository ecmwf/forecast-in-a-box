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
 * ComparePage integration tests — against MSW job + lens + WMS handlers:
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
import { resetJobsState } from '@tests/../mocks/data/job.data'
import { listMockLenses, resetLensState } from '@tests/../mocks/data/lens.data'
import { registerMockWmsServer } from '@tests/../mocks/data/wms.data'
import { ComparePage } from '@/features/compare/components/ComparePage'
import { useComparisonStore } from '@/features/compare/stores/comparisonStore'
import i18n from '@/lib/i18n'

const searchSchema = z.object({
  a: z.string().optional(),
  b: z.string().optional(),
  mode: z.enum(['swipe', 'side', 'flicker', 'spy', 'blend']).optional(),
  time: z.string().optional(),
})

function renderComparePage(search = '') {
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
  const compareRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/compare',
    validateSearch: searchSchema,
    component: ComparePage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([compareRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [`/compare${search}`] }),
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
  jobId: 'job-completed-008',
  taskId: 'task-out-grib-b',
  blockId: 'block_sink_1',
  runName: 'Run B',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
} as const

beforeEach(() => {
  resetJobsState()
  resetLensState()
  // Mock lenses allocate ports from 54300 — serve WMS on the first few so
  // panels that reach `running` can load capabilities.
  for (let port = 54300; port < 54306; port++) {
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
  }
})

describe('ComparePage', () => {
  it('renders the source picker as the empty state', async () => {
    const screen = await renderComparePage()
    await expect
      .element(screen.getByPlaceholder('Search runs and blocks…'))
      .toBeVisible()
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    // Both seeded GRIB runs offer an Add action.
    await expect
      .element(
        screen.getByRole('button', { name: /add to comparison/i }).first(),
      )
      .toBeVisible()
  })

  it('activates two sources as A/B and auto-starts one lens per directory', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderComparePage()

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
      '/data/output/job-completed-008_1',
    ])
  })

  it('starts exactly one lens when both sources resolve to the same directory', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry({
      kind: 'path',
      path: '/data/output/job-completed-001_1',
      label: 'Same dir',
    })
    const screen = await renderComparePage()

    await expect.element(screen.getByText('Same dir').first()).toBeVisible()
    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(1)
    // Give any duplicate-start race a beat to (wrongly) materialize.
    await new Promise((r) => setTimeout(r, 1500))
    expect(listMockLenses()).toHaveLength(1)
  })

  it('hydrates basket entries from a shared URL', async () => {
    const a = `run:${RUN_A.jobId}~${RUN_A.taskId}`
    const b = `run:${RUN_B.jobId}~${RUN_B.taskId}`
    await renderComparePage(
      `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    )

    await expect
      .poll(() => useComparisonStore.getState().entries, { timeout: 5000 })
      .toHaveLength(2)
    const kinds = useComparisonStore
      .getState()
      .entries.map((e) => e.kind === 'output' && e.jobId)
    expect(kinds).toEqual(['job-completed-001', 'job-completed-008'])
  })

  it('strips invalid refs from a shared URL instead of wedging', async () => {
    const screen = await renderComparePage('?a=bogus%3Anope')
    // The invalid ref is dropped; page falls back to the empty state.
    await expect
      .element(screen.getByText('GRIB directory on this host'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })

  it('Stop lens servers stops them and pauses auto-start', async () => {
    useComparisonStore.getState().addEntry(RUN_A)
    useComparisonStore.getState().addEntry(RUN_B)
    const screen = await renderComparePage()

    await expect.poll(() => listMockLenses(), { timeout: 8000 }).toHaveLength(2)
    // Wait for both to be running so the stop button targets them.
    await expect
      .poll(() => listMockLenses().every((l) => l.status === 'running'), {
        timeout: 8000,
      })
      .toBe(true)

    await screen.getByRole('button', { name: /stop lens servers/i }).click()
    await expect.poll(() => listMockLenses(), { timeout: 5000 }).toHaveLength(0)

    // Auto-start is paused: panels offer a manual start, no new lenses.
    await expect
      .element(screen.getByRole('button', { name: /^start lens$/i }).first(), {
        timeout: 5000,
      })
      .toBeVisible()
    await new Promise((r) => setTimeout(r, 1500))
    expect(listMockLenses()).toHaveLength(0)
  })
})
