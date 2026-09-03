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
 * "Build and run your first forecast" guided tour against the real
 * FableBuilderPage with MSW catalogue/expand/job handlers:
 * - the full run, every action via Show me: clean canvas (pre-satisfied) →
 *   palette → plugins → add source → validation → configure → chain a
 *   Select via the + handle → configure → product → output → Run Once →
 *   submit navigates to the run page and records `completed`
 * - rails: a valid but off-script source keeps the step; Show me fixes it;
 *   a stray block keeps the step until Show me removes it
 * - quitting records `dismissed`; Help still offers the tour
 * - a busy canvas starts at step 1 and the
 *   fresh step really empties it
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
  useSearch,
} from '@tanstack/react-router'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import { mockCatalogue } from '@tests/../mocks/data/fable.data'
import type { Locator } from '@vitest/browser/context'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { Route as ConfigureRoute } from '@/routes/_authenticated/configure'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { TutorialsController } from '@/features/tutorials/TutorialsController'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import i18n from '@/lib/i18n'

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ authType: 'anonymous', isAuthenticated: true }),
}))
vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ data: { is_superuser: true } }),
}))

const TOUR_TITLE = 'Build and run your first forecast'

function ConfigurePage() {
  const search = useSearch({ strict: false })
  return <FableBuilderPage fresh={search.fresh} />
}

async function renderConfigureWithTours() {
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
  const configureRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/configure',
    validateSearch: ConfigureRoute.options.validateSearch,
    component: ConfigurePage,
  })
  // The submit's destination; the tour only needs the pathname to change.
  const executeRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/execute/$jobId',
    component: () => <h1>Run page</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([configureRoute, executeRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/configure'] }),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { router, screen }
}

const SOURCE_ONLY: FableBuilderV1 = {
  blocks: {
    source1: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'operationalForecastSource',
      },
      configuration_values: {
        source: 'mars',
        forecast: 'aifs-ens',
        base_time: '2026-01-01T00:00',
      },
      input_ids: {},
    },
  },
}

beforeEach(() => {
  resetJobsState()
  window.localStorage.clear()
  useFableBuilderStore.getState().reset()
  // No Tailwind here: pin the shade; lift dialogs above the inline backdrop.
  const style = document.createElement('style')
  style.setAttribute('data-test-shim', 'tutorials')
  style.textContent =
    '[data-slot="spotlight-shade"]{position:fixed;inset:0;pointer-events:none}' +
    '[data-slot="alert-dialog-content"],[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;max-height:100vh;overflow:auto}'
  document.head.appendChild(style)
})

/** The Help dialog is the tour's launch surface; it closes on start. */
async function openTourFromHelp(
  screen: { getByRole: (role: string, opts: { name: string }) => Locator },
  title = TOUR_TITLE,
) {
  await screen.getByRole('button', { name: 'Help & shortcuts' }).click()
  await screen
    .getByRole('button', { name: 'Take the interactive tour' })
    .click()
  await expect
    .element(screen.getByRole('dialog', { name: title }))
    .toBeVisible()
}

function blockKinds(): Array<string> {
  return Array.from(
    document.querySelectorAll('[data-tour="configure.block"]'),
    (el) => el.getAttribute('data-block-kind') ?? '',
  )
}

describe('configure first-run tutorial', () => {
  it('walks the full path to a submitted run', { timeout: 60000 }, async () => {
    const { screen, router } = await renderConfigureWithTours()

    await openTourFromHelp(screen)
    await expect
      .element(screen.getByText('1 of 12', { exact: true }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Start', exact: true }).click()

    // Empty canvas: the fresh step is already satisfied → review mode.
    await expect
      .element(
        screen.getByRole('heading', { name: 'Start from a clean canvas' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Done — you can move on'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect
      .element(
        screen.getByRole('heading', { name: 'Blocks come in four kinds' }),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Where blocks come from' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()

    // Show me presses the canonical source row in the palette.
    await expect
      .element(screen.getByRole('heading', { name: 'Add a source' }))
      .toBeVisible()
    await expect
      .element(screen.getByText(/Click "Operational forecast source"/))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Red means "not yet"' }))
      .toBeVisible()
    expect(blockKinds()).toEqual(['source'])
    await screen.getByRole('button', { name: 'Next', exact: true }).click()

    // Show me fills the source; validation settles → next step.
    await expect
      .element(screen.getByRole('heading', { name: 'Configure the source' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Chain the next block' }), {
        timeout: 10000,
      })
      .toBeVisible()

    // By hand: the card yields while the add menu is open.
    document
      .querySelector<HTMLElement>(
        '[data-tour="configure.add-downstream"][data-block-kind="source"]',
      )
      ?.click()
    await expect
      .element(screen.getByRole('dialog', { name: 'Chain the next block' }))
      .not.toBeInTheDocument()
    await screen
      .getByRole('button', { name: /^Select/ })
      .last()
      .click()
    await expect
      .element(screen.getByRole('heading', { name: 'Narrow the data' }), {
        timeout: 10000,
      })
      .toBeVisible()
    expect(blockKinds()).toEqual(['source', 'transform'])
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    // Combined steps: first press adds, second fills.
    await expect
      .element(screen.getByRole('heading', { name: 'Compute a product' }), {
        timeout: 10000,
      })
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect.poll(() => blockKinds()).toContain('product')
    // The block exists → the step re-anchors to the config panel.
    await expect
      .element(
        screen.getByRole('heading', { name: 'Configure the statistics' }),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    await expect
      .element(screen.getByRole('heading', { name: 'Finish with an output' }), {
        timeout: 10000,
      })
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect.poll(() => blockKinds()).toContain('sink')
    await expect
      .element(screen.getByRole('heading', { name: 'Configure the plot' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()

    // Run step: Show me opens the submit dialog; the user submits.
    await expect
      .element(screen.getByRole('heading', { name: 'Run it' }), {
        timeout: 10000,
      })
      .toBeVisible()
    await expect
      .element(screen.getByText('Valid', { exact: true }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Submit Forecast Job' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Submit Job' }).click()

    // The expected navigation completes the tour instead of ending it.
    await expect
      .poll(() => router.state.location.pathname, { timeout: 10000 })
      .toMatch(/^\/execute\//)
    await expect
      .poll(() => useTutorialsStore.getState().statuses['configure-first-run'])
      .toBe('completed')
    expect(useTutorialsStore.getState().active).toBeNull()
  })

  it('rails: a valid but off-script source does not advance', async () => {
    const { screen } = await renderConfigureWithTours()
    useTutorialsStore.getState().start('configure-first-run')
    useTutorialsStore.getState().setStep(4)
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Configure the source' }))
      .toBeVisible()

    // MARS validates fine in the mock, but it is not the tour's pipeline.
    const store = useFableBuilderStore.getState()
    const [id] = Object.keys(store.fable.blocks)
    store.updateBlockConfigBatch(id, {
      source: 'mars',
      forecast: 'ifs-ens',
      base_time: '2026-01-01T00:00:00',
    })
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 10000,
      })
      .toBe(true)
    await expect
      .element(screen.getByRole('heading', { name: 'Configure the source' }))
      .toBeVisible()
    // The card says which field is off-script.
    await expect
      .element(screen.getByText('Not yet — set Source to ecmwf-open-data.'))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Chain the next block' }), {
        timeout: 10000,
      })
      .toBeVisible()
  })

  it('rails: a stray block blocks the step until Show me removes it', async () => {
    const { screen } = await renderConfigureWithTours()
    useTutorialsStore.getState().start('configure-first-run')
    useTutorialsStore.getState().setStep(4)
    await expect
      .element(screen.getByRole('heading', { name: 'Add a source' }))
      .toBeVisible()

    // Off-script block dragged in from the palette.
    const zarr = mockCatalogue['ecmwf/ecmwf-base'].factories.zarrSink
    useFableBuilderStore.getState().addBlock(
      {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'zarrSink',
      },
      zarr,
    )
    await expect.element(screen.getByText(/remove Zarr Sink/)).toBeVisible()

    // First press removes the stray; second adds the canonical source.
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect.poll(() => blockKinds()).toEqual([])
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Red means "not yet"' }))
      .toBeVisible()
  })

  it('quitting records dismissed; Help still offers the tour', async () => {
    const { screen } = await renderConfigureWithTours()

    await openTourFromHelp(screen)
    await screen.getByRole('button', { name: 'Skip tour', exact: true }).click()

    await expect
      .poll(() => useTutorialsStore.getState().statuses['configure-first-run'])
      .toBe('dismissed')
    await expect
      .element(screen.getByRole('dialog', { name: TOUR_TITLE }))
      .not.toBeInTheDocument()
    await openTourFromHelp(screen)
  })

  it('a busy canvas starts at step 1 and the fresh step empties it', async () => {
    useFableBuilderStore.getState().setFable(SOURCE_ONLY, null)
    const { screen } = await renderConfigureWithTours()
    await expect.poll(() => blockKinds()).toEqual(['source'])

    // Mid-session variant on the orient step — no fast-forward.
    await openTourFromHelp(screen, 'Take the tour from the top')
    await screen.getByRole('button', { name: 'Start', exact: true }).click()

    // Not pre-satisfied: Show me presses New configuration → 0 blocks.
    await expect
      .element(
        screen.getByRole('heading', { name: 'Start from a clean canvas' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Done — you can move on'))
      .not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Blocks come in four kinds' }),
        {
          timeout: 10000,
        },
      )
      .toBeVisible()
    expect(blockKinds()).toEqual([])
  })
})
