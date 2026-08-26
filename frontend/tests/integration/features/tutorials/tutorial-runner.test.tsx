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
 * "Your first map" guided tour against the real VisualisePage with MSW
 * job/lens/WMS handlers (the curated ECMWF/DWD hosts are mock-served):
 * - the full run: hub CTA → orient → add the canonical server → map →
 *   layer pick (URL signal) → active panel → step time → add DWD via the
 *   picker dialog → give B a layer → switch comparison mode → done,
 *   recording `completed`
 * - "Show me" presses the canonical server's real Add button
 * - quitting records `dismissed`; the hub CTA stays as it was
 * - a mid-session launch still starts at step 1, reviewing satisfied steps
 * - the compare step's Show me assigns an already-collected DWD to slot B
 *   (an earlier tour run left it in the basket; B was deliberately off)
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
import { resetJobsState } from '@tests/../mocks/data/job.data'
import { resetLensState } from '@tests/../mocks/data/lens.data'
import { registerMockWmsServer } from '@tests/../mocks/data/wms.data'
import { Route as VisualiseRoute } from '@/routes/_authenticated/visualise'
import { setPollIntervalsForTests } from '@/api/pollIntervals'
import { VisualisePage } from '@/features/visualise/components/VisualisePage'
import { TutorialsController } from '@/features/tutorials/TutorialsController'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import { entryRef } from '@/features/visualise/entry-ref'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import i18n from '@/lib/i18n'

const TIMES = '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z'

const RUN_A = {
  kind: 'output',
  jobId: 'job-completed-001',
  taskId: 'task-out-grib',
  blockId: 'block_sink_1',
  runName: 'Run A',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
} as const

function renderVisualiseWithTours(search = '') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => (
      <>
        <Outlet />
        <TutorialsController />
      </>
    ),
  })
  const visualiseRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/visualise',
    validateSearch: VisualiseRoute.options.validateSearch,
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

beforeEach(() => {
  setPollIntervalsForTests({
    lensList: 250,
    lensStarting: 100,
    lensRunning: 250,
    lensRetryBase: 40,
  })
  resetJobsState()
  resetLensState()
  // No Tailwind in browser mode — pin the shade so it can't cover the page.
  const style = document.createElement('style')
  style.setAttribute('data-test-shim', 'tutorials')
  style.textContent =
    '[data-slot="spotlight-shade"]{position:fixed;inset:0;pointer-events:none}'
  document.head.appendChild(style)
  // The tour's canonical servers (slot A + comparison slot B), keyed by
  // hostname. Shared valid times keep the two-source timeline alive.
  registerMockWmsServer('eccharts.ecmwf.int', {
    layers: [{ name: '2t', title: '2 m temperature', time: TIMES }],
  })
  // Disjoint layer names — the browser auto-unlinks, like real servers.
  // A static layer leads the list; Show me must prefer the time-aware one.
  registerMockWmsServer('maps.dwd.de', {
    layers: [
      { name: 'overview', title: 'Static overview' },
      {
        name: 'precip',
        title: 'Total precipitation',
        time: TIMES,
      },
    ],
  })
  // Auto-started lenses (the mid-session test's run source) count from
  // lens-1; the unregistered-id fallback has time dimensions.
  for (let i = 1; i <= 6; i++) {
    registerMockWmsServer(`lens-${i}`, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
  }
})

/** The canonical server's real Add button in the curated list. */
function ecmwfAddButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-tour-action="add"][data-server="ECMWF"]',
  )
}

describe('visualise first-map tutorial', () => {
  it('walks the full path to completion', { timeout: 40000 }, async () => {
    const screen = await renderVisualiseWithTours()

    // Hub CTA is the empty-state launch surface.
    await screen
      .getByRole('button', {
        name: 'Take the "Visualise forecasts on a map" tour',
      })
      .click()

    await expect
      .element(
        screen.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('1 of 10', { exact: true }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Start', exact: true }).click()

    // The canonical-server step interpolates the server name into its copy.
    await expect
      .element(
        screen.getByRole('heading', { name: 'Connect a live weather server' }),
      )
      .toBeVisible()
    await expect.element(screen.getByText(/Press "Add" on ECMWF/)).toBeVisible()

    // The real action: the ECMWF row's Add button (probe is mock-served).
    ecmwfAddButton()?.click()

    // A WMS source needs no lens — the map opens directly.
    await expect
      .element(screen.getByRole('heading', { name: 'This is your map' }), {
        timeout: 15000,
      })
      .toBeVisible()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()

    // Layer step advances via the `la` URL param (400 ms debounce).
    await expect
      .element(screen.getByRole('heading', { name: 'Put data on the map' }))
      .toBeVisible()
    await screen
      .getByRole('button', { name: /2 m temperature/ })
      .first()
      .click()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Your active layers live here' }),
        {
          timeout: 10000,
        },
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()

    // Time step: Show me presses the real next-step arrow → `t` changes.
    await expect
      .element(screen.getByRole('heading', { name: 'Step through time' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    // Compare step: one Show me opens the picker dialog AND adds DWD (the
    // modal makes the page inert, so the follow-up press is automatic).
    await expect
      .element(screen.getByRole('heading', { name: 'Add a second forecast' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    // B fills → the B-layer step enters and closes the dialog behind it.
    await expect
      .element(screen.getByRole('heading', { name: 'Give B a layer too' }), {
        timeout: 15000,
      })
      .toBeVisible()
    await expect
      .element(screen.getByRole('heading', { name: 'Manage sources' }))
      .not.toBeInTheDocument()
    // Show me switches to the B tab, then picks a TIME-AWARE B layer —
    // never the static one that happens to sit first in the list.
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    await expect
      .element(
        screen.getByRole('heading', { name: 'Compare the two forecasts' }),
        { timeout: 15000 },
      )
      .toBeVisible()
    const activeB = document.querySelector(
      '[data-source-slots="b"][aria-pressed="true"]',
    )
    expect(activeB?.textContent).toContain('Total precipitation')
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    await expect
      .element(
        screen.getByRole('heading', {
          name: "That's a live forecast comparison",
        }),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Done', exact: true }).click()

    await expect
      .poll(() => useTutorialsStore.getState().statuses['visualise-first-map'])
      .toBe('completed')
    expect(useTutorialsStore.getState().active).toBeNull()
  })

  it('Show me presses the canonical server’s Add button', async () => {
    const screen = await renderVisualiseWithTours()

    await screen
      .getByRole('button', {
        name: 'Take the "Visualise forecasts on a map" tour',
      })
      .click()
    await screen.getByRole('button', { name: 'Start', exact: true }).click()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Connect a live weather server' }),
      )
      .toBeVisible()

    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    // The targeted row — not the list's first server — was added.
    await expect
      .poll(() =>
        useComparisonStore
          .getState()
          .entries.some((e) => e.kind === 'wms' && e.label === 'ECMWF'),
      )
      .toBe(true)
    await expect
      .element(screen.getByRole('heading', { name: 'This is your map' }), {
        timeout: 15000,
      })
      .toBeVisible()
  })

  it('quitting records dismissed and keeps the CTA', async () => {
    const screen = await renderVisualiseWithTours()

    const cta = screen.getByRole('button', {
      name: 'Take the "Visualise forecasts on a map" tour',
    })
    await cta.click()
    await expect
      .element(
        screen.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
      )
      .toBeVisible()

    await screen.getByRole('button', { name: 'Skip tour', exact: true }).click()

    await expect
      .poll(() => useTutorialsStore.getState().statuses['visualise-first-map'])
      .toBe('dismissed')
    await expect
      .element(
        screen.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
      )
      .not.toBeInTheDocument()
    // The empty state keeps its tour entry point, label unchanged.
    await expect.element(cta).toBeVisible()
  })

  it('starts at step 1 even when a source is already on the map', async () => {
    const screen = await renderVisualiseWithTours()

    useComparisonStore.getState().addEntry(RUN_A)
    await expect
      .poll(() => document.querySelector('[data-tour="visualise.map"]'), {
        timeout: 15000,
      })
      .not.toBeNull()
    useTutorialsStore.getState().start('visualise-first-map')

    // The orient step shows its mid-session variant — no fast-forward.
    await expect
      .element(
        screen.getByRole('heading', { name: 'Take the tour from the top' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('1 of 10', { exact: true }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Start', exact: true }).click()

    // The satisfied add step surfaces as review (centered — the hub is gone).
    await expect
      .element(
        screen.getByRole('heading', { name: 'Connect a live weather server' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Done — you can move on'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect
      .element(screen.getByRole('heading', { name: 'This is your map' }))
      .toBeVisible()
  })

  it('compare Show me assigns an already-collected DWD to an off slot B', async () => {
    const ecmwf = {
      kind: 'wms',
      url: 'https://eccharts.ecmwf.int/wms/?token=public',
      label: 'ECMWF',
    } as const
    const dwd = {
      kind: 'wms',
      url: 'https://maps.dwd.de/geoserver/ows?',
      label: 'DWD',
    } as const
    useComparisonStore.getState().addEntry(ecmwf)
    useComparisonStore.getState().addEntry(dwd)
    const screen = await renderVisualiseWithTours(
      `?a=${encodeURIComponent(entryRef(ecmwf))}&b=off`,
    )
    await expect
      .poll(() => document.querySelector('[data-tour="visualise.map"]'), {
        timeout: 15000,
      })
      .not.toBeNull()
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().setStep(6)

    // DWD's Add button reads "Added" (disabled) — nothing to press, so the
    // step applies the slot-bar assignment itself.
    await expect
      .element(screen.getByRole('heading', { name: 'Add a second forecast' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Give B a layer too' }), {
        timeout: 15000,
      })
      .toBeVisible()
  })
})
