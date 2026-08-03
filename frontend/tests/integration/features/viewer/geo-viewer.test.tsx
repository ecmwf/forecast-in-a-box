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
 * GeoViewer integration tests — two mock WMS servers, asserting on
 * controls and state (never canvas pixels): mode switcher, linked pairing
 * with availability chips, add-to-both, union timeline with gap badges,
 * swipe divider a11y, flicker toggle, zero-overlap auto-unlink.
 */

import axe from 'axe-core'
import { createContext, useContext, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from '@vitest/browser/context'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouter,
} from '@tanstack/react-router'
import {
  getMapRequests,
  registerMockWmsServer,
} from '@tests/../mocks/data/wms.data'
import type { CompareMode } from '@/features/viewer/geo/types'
import type { ViewerUrlState } from '@/features/viewer/geo/view-url-state'
import { GeoViewer } from '@/features/viewer/geo/GeoViewer'
import i18n from '@/lib/i18n'

let nextPort = 19800

afterEach(() => {
  vi.restoreAllMocks()
})

/** A: 2t (T00,T06) + msl + tp + q@500/850 · B: 2t (T06,T12) + msl +
 *  q@500/700 — overlap 2t/msl/q@500. */
function registerDefaultPair(): { portA: number; portB: number } {
  const portA = nextPort++
  const portB = nextPort++
  registerMockWmsServer(portA, {
    layers: [
      {
        name: '2t',
        title: '2 m temperature',
        time: '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z',
      },
      { name: 'msl', title: 'Mean sea level pressure' },
      { name: 'tp', title: 'Total precipitation' },
      { name: 'q@pl_500', title: 'Specific humidity at 500 hPa' },
      { name: 'q@pl_850', title: 'Specific humidity at 850 hPa' },
    ],
  })
  registerMockWmsServer(portB, {
    layers: [
      {
        name: '2t',
        title: '2 m temperature',
        time: '2026-07-06T06:00:00Z,2026-07-06T12:00:00Z',
      },
      { name: 'msl', title: 'Mean sea level pressure' },
      { name: 'q@pl_500', title: 'Specific humidity at 500 hPa' },
      { name: 'q@pl_700', title: 'Specific humidity at 700 hPa' },
    ],
  })
  return { portA, portB }
}

/** Router shell — the viewer's route-leave guard (useBlocker) needs a
 *  RouterProvider; '/away' plus the nav button exercise it. The body
 *  flows through context so screen.rerender() props reach the route. */
const HarnessBody = createContext<() => React.ReactNode>(() => null)
function HomeBody() {
  return useContext(HarnessBody)()
}
function RouterHarness({ children }: { children: () => React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const home = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: HomeBody,
    })
    const away = createRoute({
      getParentRoute: () => rootRoute,
      path: '/away',
      component: () => <div>Away page</div>,
    })
    return createRouter({
      routeTree: rootRoute.addChildren([home, away]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <HarnessBody.Provider value={children}>
          <RouterProvider router={router} />
        </HarnessBody.Provider>
      </I18nextProvider>
    </QueryClientProvider>
  )
}

function ViewerRoute({
  portA,
  portB,
  initialMode = 'swipe',
  initialViewState,
  onViewStateChange,
}: {
  portA: number
  portB: number
  initialMode?: CompareMode
  initialViewState?: ViewerUrlState
  onViewStateChange?: (partial: Partial<ViewerUrlState>) => void
}) {
  const [mode, setMode] = useState<CompareMode>(initialMode)
  // Slot swap mirrors VisualisePage: a pure a↔b prop exchange.
  const [swapped, setSwapped] = useState(false)
  const router = useRouter()
  const srcA = {
    id: `run:test-${portA}`,
    baseUrl: `http://localhost:${portA}`,
    label: 'Run A',
  }
  const srcB = {
    id: `run:test-${portB}`,
    baseUrl: `http://localhost:${portB}`,
    label: 'Run B',
  }
  return (
    <div style={{ width: 1100, height: 700 }}>
      <button onClick={() => router.history.push('/away')}>go away</button>
      <button onClick={() => router.history.push('/?probe=1')}>
        tweak search
      </button>
      <button onClick={() => setSwapped((v) => !v)}>swap slots</button>
      <GeoViewer
        a={swapped ? srcB : srcA}
        b={swapped ? srcA : srcB}
        mode={mode}
        onModeChange={setMode}
        initialViewState={initialViewState}
        onViewStateChange={onViewStateChange}
      />
    </div>
  )
}

function Harness(props: {
  portA: number
  portB: number
  initialMode?: CompareMode
  initialViewState?: ViewerUrlState
  onViewStateChange?: (partial: Partial<ViewerUrlState>) => void
}) {
  return <RouterHarness>{() => <ViewerRoute {...props} />}</RouterHarness>
}

/** Unstyled env: the map containers collapse to 0×0 and OL never renders.
 *  Tests that need real GetMap traffic or captures give maps pixels. */
function injectMapSizing(): () => void {
  const style = document.createElement('style')
  style.textContent = `
      [class*='h-full'][class*='overflow-hidden'][class*='rounded-md'] { position: relative; height: 400px; }
      [class*='absolute'][class*='inset-0'] { position: absolute; inset: 0; }
    `
  document.head.append(style)
  return () => style.remove()
}

describe('GeoViewer', () => {
  it('shows paired layers with per-source availability chips', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    await expect
      .element(screen.getByText('Mean sea level pressure'))
      .toBeVisible()
    // tp exists only in A: its row carries a "not available in B" chip.
    const tpRow = screen.getByText('Total precipitation')
    await expect.element(tpRow).toBeVisible()
    await expect
      .element(screen.getByTitle('Not available in B'))
      .toBeInTheDocument()
  })

  it('activates a pair on both sources and builds the union timeline with gaps', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByText('2 m temperature').first().click()

    // Union of T00/T06 (A) and T06/T12 (B) → three steps.
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
    // At T00 only A has data → gap badge for B (swipe = single map).
    await expect
      .element(screen.getByText('No data at this time — B'))
      .toBeVisible()

    // Step to T06 — both available, no badges.
    await screen.getByRole('button', { name: 'Next time step' }).click()
    await expect.element(screen.getByText('2 / 3')).toBeVisible()
    expect(screen.getByText(/No data at this time/).elements()).toHaveLength(0)

    // Step to T12 — now A is the gap.
    await screen.getByRole('button', { name: 'Next time step' }).click()
    await expect
      .element(screen.getByText('No data at this time — A'))
      .toBeVisible()
  })

  it('static layers get a hint bar instead of a collapsed timeline', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    // Nothing active yet — the bar is already present as the static hint.
    await expect.element(screen.getByText(/display is static/)).toBeVisible()

    // msl advertises no TIME: hint stays, card and browser rows say why.
    await screen.getByText('Mean sea level pressure').first().click()
    await expect.element(screen.getByText(/display is static/)).toBeVisible()
    await expect
      .element(screen.getByText('Static', { exact: true }))
      .toBeVisible()
    // Browser rows carry the timer-off glyph for static layers.
    const glyphCount = () =>
      document.querySelectorAll(
        '[title="No time dimension — renders unchanged at every time step"]',
      ).length
    expect(glyphCount()).toBeGreaterThan(0)

    // The focused (per-source) browser path shows it too.
    await screen.getByRole('button', { name: 'View only B' }).click()
    await expect.poll(glyphCount).toBeGreaterThan(0)
    await screen.getByRole('button', { name: 'View both (compare)' }).click()

    // A temporal layer swaps the hint for the real slider.
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
    expect(screen.getByText(/display is static/).elements()).toHaveLength(0)
  })

  it('exposes the swipe divider as an accessible slider', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    const divider = screen.getByRole('slider', {
      name: 'Comparison divider',
    })
    await expect.element(divider).toHaveAttribute('aria-valuenow', '50')
    const element = divider.element() as HTMLElement
    element.focus()
    await screen.getByRole('slider', { name: 'Comparison divider' })
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    await expect.element(divider).toHaveAttribute('aria-valuenow', '52')
  })

  it('switches modes; flicker toggles the visible source', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByRole('button', { name: /flicker/i }).click()
    const toggle = screen.getByRole('button', { name: 'Showing: A' })
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect
      .element(screen.getByRole('button', { name: 'Showing: B' }))
      .toHaveAttribute('aria-pressed', 'true')

    // Side-by-side renders both slot tags as separate panels.
    await screen.getByRole('button', { name: /side by side/i }).click()
    expect(screen.getByText('Run A').elements()).toHaveLength(1)
    expect(screen.getByText('Run B').elements()).toHaveLength(1)
  })

  it('groups pressure levels and activates one entry on both sources', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    // Collapsible group with the level union (500 shared, 700 B, 850 A).
    const group = screen.getByRole('button', { name: /Specific humidity/ })
    await expect.element(group).toBeVisible()
    await expect.element(screen.getByText('3 levels')).toBeVisible()
    await group.click()
    await expect
      .element(screen.getByRole('button', { name: /850 hPa/ }))
      .toBeVisible()

    // 500 hPa exists in both sources → activating shows it in the active
    // panel with an opacity slider.
    await screen.getByRole('button', { name: /500 hPa/ }).click()
    await expect
      .element(
        screen.getByRole('slider', {
          name: /Specific humidity · 500 hPa opacity/,
        }),
      )
      .toBeInTheDocument()
  })

  it('filters the browser by slot availability', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await expect.element(screen.getByText('Total precipitation')).toBeVisible()
    // Show only layers available in B → the A-only parameter disappears.
    await screen.getByRole('button', { name: 'B', exact: true }).click()
    await expect
      .element(screen.getByText('Total precipitation'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()
    // Back to all.
    await screen.getByRole('button', { name: 'All' }).click()
    await expect.element(screen.getByText('Total precipitation')).toBeVisible()
  })

  it('exposes the opacity hierarchy: global, per-source, per-layer', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await expect
      .element(screen.getByRole('slider', { name: /Global opacity/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('slider', { name: /All of A/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('slider', { name: /All of B/ }))
      .toBeInTheDocument()

    await screen.getByText('2 m temperature').first().click()
    await expect
      .element(screen.getByRole('slider', { name: /2 m temperature opacity/ }))
      .toBeInTheDocument()
  })

  it('shows contextual mode controls in the toolbar action row', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    // Swipe: orientation control; switching keeps the divider accessible.
    await expect
      .element(screen.getByRole('button', { name: 'Horizontal' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Horizontal' }).click()
    await expect
      .element(screen.getByRole('slider', { name: 'Comparison divider' }))
      .toHaveAttribute('aria-orientation', 'vertical')

    // Spy: shape + size controls.
    await screen.getByRole('button', { name: /^Spy/ }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Rectangle' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('slider', { name: /Spy size/ }))
      .toBeInTheDocument()

    // Blend: the weight slider lives in the action row now.
    await screen.getByRole('button', { name: /blend/i }).click()
    await expect
      .element(screen.getByRole('slider', { name: /Blend B over A/ }))
      .toBeInTheDocument()
    // Loupe lives as a toolbar split-button now, not an always-on row.
    await expect
      .element(screen.getByRole('button', { name: 'Magnifier on' }))
      .toBeVisible()
  })

  it('drives sidebars, modes, and help via keyboard shortcuts', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await expect.element(screen.getByText('Active layers')).toBeVisible()

    // TanStack Hotkeys listens on document; keyup resets its held-key
    // tracker between presses.
    const press = (key: string) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      )
      document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
    }

    // B toggles both sidebars (hidden, not unmounted — state persists).
    // S belongs to WASD panning now.
    press('b')
    await expect.element(screen.getByText('Active layers')).not.toBeVisible()
    press('b')
    await expect.element(screen.getByText('Active layers')).toBeVisible()

    // 1 → side-by-side (both slot tags visible as separate panels).
    press('1')
    await expect
      .element(screen.getByRole('button', { name: /side by side/i }))
      .toHaveAttribute('aria-pressed', 'true')
    press('2')
    await expect
      .element(screen.getByRole('button', { name: /swipe/i }))
      .toHaveAttribute('aria-pressed', 'true')

    // N arms the annotate tool; Escape disarms it.
    const annotateButton = screen.getByRole('button', { name: /Annotate/ })
    press('n')
    await expect.element(annotateButton).toHaveAttribute('aria-pressed', 'true')
    press('Escape')
    await expect
      .element(annotateButton)
      .toHaveAttribute('aria-pressed', 'false')

    // H opens the help dialog with the shortcut table.
    press('h')
    await expect.element(screen.getByText('Keyboard shortcuts')).toBeVisible()
    await expect.element(screen.getByText('Comparison modes')).toBeVisible()
    press('h')
  })

  it('offers a basemap picker with an opacity slider', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByRole('button', { name: 'Basemap' }).click()
    await expect
      .element(screen.getByRole('button', { name: /Carto Positron/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('slider', { name: /Basemap opacity/ }))
      .toBeInTheDocument()
  })

  it('collapses and restores both sidebars, preserving their state', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await expect.element(screen.getByText('Active layers')).toBeVisible()
    // Pick a non-default filter — it must survive collapse/expand
    // (panels are hidden, not unmounted).
    await screen.getByRole('button', { name: 'B', exact: true }).click()

    // Left first in DOM, right second.
    await screen
      .getByRole('button', { name: 'Collapse sidebar' })
      .first()
      .click()
    await expect.element(screen.getByText('Active layers')).not.toBeVisible()
    await screen
      .getByRole('button', { name: 'Collapse sidebar' })
      .first()
      .click()
    await expect
      .element(screen.getByText('2 m temperature').first())
      .not.toBeVisible()

    const handles = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(handles.elements()).toHaveLength(2)
    await handles.first().click()
    await expect.element(screen.getByText('Active layers')).toBeVisible()
    await handles.click()
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'B', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('exposes export and overlay-upload entry points', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByRole('button', { name: 'Export' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Download PNG' }))
      .toBeVisible()
    // Close the dialog again (Escape).
    await screen.getByRole('button', { name: 'Download PNG' })
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    await expect.element(screen.getByText('Add GeoJSON')).toBeVisible()
  })

  it('offers copy-to-clipboard with a synchronously built PNG item', async () => {
    const { portA, portB } = registerDefaultPair()
    let lastItem: ClipboardItem | null = null
    const write = vi
      .spyOn(navigator.clipboard, 'write')
      .mockImplementation((items) => {
        lastItem = items[0]
        return Promise.resolve()
      })
    const removeSizing = injectMapSizing()
    try {
      const screen = await render(<Harness portA={portA} portB={portB} />)
      await screen.getByText('2 m temperature').first().click()

      await screen
        .getByRole('button', { name: 'Copy map to clipboard' })
        .click()
      // Item constructed synchronously in the gesture (Safari rule).
      expect(write).toHaveBeenCalledTimes(1)
      expect(lastItem!.types).toContain('image/png')
      await expect(lastItem!.getType('image/png')).resolves.toBeInstanceOf(Blob)

      // Per-slot copy via the split-button menu. The payload must actually
      // produce pixels: a stale captureOnly closure once filtered every
      // capture out and rejected here.
      await screen.getByRole('button', { name: 'Copy options' }).click()
      await screen.getByRole('menuitem', { name: 'Copy A only' }).click()
      expect(write).toHaveBeenCalledTimes(2)
      const blob = await lastItem!.getType('image/png')
      expect(blob.size).toBeGreaterThan(0)
    } finally {
      removeSizing()
    }
  })

  it('offers measure tools that toggle exclusively', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    const line = screen.getByRole('button', { name: 'Measure distance' })
    const area = screen.getByRole('button', { name: 'Measure area' })
    await expect.element(line).toHaveAttribute('aria-pressed', 'false')
    await line.click()
    await expect.element(line).toHaveAttribute('aria-pressed', 'true')
    await area.click()
    await expect.element(line).toHaveAttribute('aria-pressed', 'false')
    await expect.element(area).toHaveAttribute('aria-pressed', 'true')
    // Clear is always available.
    await screen.getByRole('button', { name: 'Clear measurements' }).click()
  })

  it('creates, lists, edits, and deletes annotations', async () => {
    // Unstyled tests: Base UI's inert backdrop overlays the dialog unless
    // the dialog keeps its production positioning (see CommandPalette
    // tests for the same workaround).
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50}'
    document.head.appendChild(style)

    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    // Arm the tool, click the map, record a finding.
    await screen.getByRole('button', { name: /Annotate/ }).click()
    await screen.getByText('2 m temperature').first().click()
    // Tests run unstyled (no Tailwind), so the map container collapses to
    // zero size — give it real dimensions; OL's ResizeObserver follows.
    const map = document.querySelector('.ol-viewport')
    expect(map).not.toBeNull()
    const container = (map as HTMLElement).parentElement!
    container.style.cssText = 'position:relative;width:800px;height:400px'
    const viewport = page.elementLocator(map as Element)
    // Unstyled flow can push the map below the test window's fold, where
    // position-clicks silently miss OL — bring it into view first.
    ;(map as HTMLElement).scrollIntoView({ block: 'center' })
    // x=200 keeps clear of the swipe divider at the 50% mark.
    await viewport.click({ position: { x: 200, y: 200 } })
    await expect.element(screen.getByText('New annotation')).toBeVisible()
    await screen
      .getByPlaceholder('Record your finding…')
      .fill('Deep low over the gulf')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Listed in the left sidebar with its number.
    await expect
      .element(screen.getByText('Deep low over the gulf'))
      .toBeVisible()

    // Edit via the row's pencil (row click pans instead), then delete.
    await screen.getByRole('button', { name: 'Edit annotation 1' }).click()
    await expect.element(screen.getByText('Edit annotation')).toBeVisible()
    await screen.getByRole('button', { name: 'Delete' }).click()
    await expect
      .element(screen.getByText('Deep low over the gulf'))
      .not.toBeInTheDocument()
  })

  it('labels are sticky through deletes, editable, and colorable', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50}'
    document.head.appendChild(style)

    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByRole('button', { name: /Annotate/ }).click()
    await screen.getByText('2 m temperature').first().click()
    const map = document.querySelector('.ol-viewport')
    const container = (map as HTMLElement).parentElement!
    container.style.cssText = 'position:relative;width:800px;height:400px'
    ;(map as HTMLElement).scrollIntoView({ block: 'center' })
    const viewport = page.elementLocator(map as Element)

    // Pin 1: label auto-suggested as "1".
    await viewport.click({ position: { x: 200, y: 200 } })
    await expect.element(screen.getByLabelText('Label')).toHaveValue('1')
    await screen.getByPlaceholder('Record your finding…').fill('first')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    // Pin 2 (clear of pin 1's hit radius): suggested "2".
    await viewport.click({ position: { x: 320, y: 260 } })
    await expect.element(screen.getByLabelText('Label')).toHaveValue('2')
    await screen.getByPlaceholder('Record your finding…').fill('second')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Deleting 1 must NOT renumber 2 — labels are sticky.
    await screen.getByRole('button', { name: 'Remove annotation 1' }).click()
    await expect
      .poll(
        () =>
          screen.getByRole('button', { name: 'Remove annotation 1' }).elements()
            .length,
      )
      .toBe(0)
    expect(
      screen.getByRole('button', { name: 'Remove annotation 2' }).elements(),
    ).toHaveLength(1)

    // Relabel + recolor via the editor.
    await screen.getByRole('button', { name: 'Edit annotation 2' }).click()
    await screen.getByLabelText('Label').fill('X9')
    // Palette is collapsed to the current swatch — expand, then pick.
    await screen.getByRole('button', { name: 'Pin color' }).click()
    await screen.getByRole('radio', { name: 'Red' }).click()
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Remove annotation X9' }))
      .toBeInTheDocument()
    style.remove()
  })

  it('annotates per panel in side-by-side mode', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50}'
    document.head.appendChild(style)

    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <Harness portA={portA} portB={portB} initialMode="side" />,
    )
    await screen.getByRole('button', { name: /Annotate/ }).click()

    const viewports = document.querySelectorAll('.ol-viewport')
    expect(viewports.length).toBe(2)
    for (const v of viewports) {
      const container = (v as HTMLElement).parentElement!
      container.style.cssText = 'position:relative;width:500px;height:400px'
    }
    // Click panel B (second map).
    await page
      .elementLocator(viewports[1])
      .click({ position: { x: 250, y: 200 } })
    await expect.element(screen.getByText('New annotation')).toBeVisible()
    await screen.getByPlaceholder('Record your finding…').fill('B-side eddy')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Listed with the B slot badge.
    await expect.element(screen.getByText('B-side eddy')).toBeVisible()
    await expect
      .element(screen.getByTitle('B', { exact: true }))
      .toBeInTheDocument()
  })

  it('annotations follow their source through a slot swap', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50}'
    document.head.appendChild(style)

    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <Harness portA={portA} portB={portB} initialMode="side" />,
    )
    await screen.getByRole('button', { name: /Annotate/ }).click()

    const viewports = document.querySelectorAll('.ol-viewport')
    expect(viewports.length).toBe(2)
    for (const v of viewports) {
      const container = (v as HTMLElement).parentElement!
      container.style.cssText = 'position:relative;width:500px;height:400px'
    }
    await page
      .elementLocator(viewports[1])
      .click({ position: { x: 250, y: 200 } })
    await expect.element(screen.getByText('New annotation')).toBeVisible()
    await screen.getByPlaceholder('Record your finding…').fill('B-side eddy')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .element(screen.getByTitle('B', { exact: true }))
      .toBeInTheDocument()

    // Swap: the pin's source now sits in slot A — attribution follows it.
    await screen.getByRole('button', { name: 'swap slots' }).click()
    await expect
      .element(screen.getByTitle('A', { exact: true }))
      .toBeInTheDocument()
    expect(screen.getByTitle('B', { exact: true }).elements()).toHaveLength(0)
    style.remove()
  })

  it('unlinked per-side selections follow their source through a swap', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    registerMockWmsServer(portB, {
      layers: [{ name: 'tp', title: 'Total precipitation' }],
    })
    const screen = await render(<Harness portA={portA} portB={portB} />)

    // Zero overlap auto-unlinks; activate one layer per side.
    await screen.getByText('2 m temperature').first().click()
    await screen.getByRole('button', { name: 'B', exact: true }).click()
    await screen.getByText('Total precipitation').first().click()

    await screen.getByRole('button', { name: 'swap slots' }).click()

    // Each active-layer section now lists its source's own selection.
    // (The label also appears in the map's slot tag — scope to <section>.)
    const sectionWith = (label: string) =>
      page.elementLocator(
        screen
          .getByText(label)
          .elements()
          .map((e) => e.closest('section'))
          .find((s) => s !== null)!,
      )
    await expect
      .element(
        sectionWith('Run B').getByText('Total precipitation', { exact: true }),
      )
      .toBeVisible()
    await expect
      .element(
        sectionWith('Run A').getByText('2 m temperature', { exact: true }),
      )
      .toBeVisible()
    // The raw layer names never leak (an unmapped list would show '2t').
    expect(screen.getByText('2t', { exact: true }).elements()).toHaveLength(0)
    expect(screen.getByText('tp', { exact: true }).elements()).toHaveLength(0)
  })

  it('negates the time offset on swap so the alignment is preserved', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByLabelText('Time link mode').click()
    await screen
      .getByRole('option', { name: 'Time offset (B = A + Δ)' })
      .click()
    await screen.getByRole('button', { name: 'Align starts' }).click()
    await expect.element(screen.getByText('B +6 h')).toBeVisible()

    // Post-swap Δ must be −6 h — same physical pairing, sides exchanged.
    await screen.getByRole('button', { name: 'swap slots' }).click()
    await expect.element(screen.getByText('B −6 h')).toBeVisible()
    await expect.element(screen.getByRole('textbox').first()).toHaveValue('-6')
    expect(screen.getByText('B +6 h').elements()).toHaveLength(0)
  })

  it('drops unlinked names a replaced source cannot serve', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    registerMockWmsServer(portB, {
      layers: [{ name: 'tp', title: 'Total precipitation' }],
    })
    const reports: Array<Partial<ViewerUrlState>> = []
    const screen = await render(
      <Harness
        portA={portA}
        portB={portB}
        onViewStateChange={(p) => reports.push(p)}
      />,
    )

    // Zero overlap auto-unlinks; select one layer per side.
    await screen.getByText('2 m temperature').first().click()
    await screen.getByRole('button', { name: 'B', exact: true }).click()
    await screen.getByText('Total precipitation').first().click()
    await vi.waitFor(() => {
      const last = [...reports].reverse().find((r) => r.layersA !== undefined)
      expect(last?.layersA).toEqual(['2t'])
      expect(last?.layersB).toEqual(['tp'])
    })

    // A source without 2t replaces A: state and URL drop it, B survives.
    const portA2 = nextPort++
    registerMockWmsServer(portA2, {
      layers: [{ name: 'msl', title: 'Mean sea level pressure' }],
    })
    await screen.rerender(
      <Harness
        portA={portA2}
        portB={portB}
        onViewStateChange={(p) => reports.push(p)}
      />,
    )
    await vi.waitFor(() => {
      const last = [...reports].reverse().find((r) => r.layersA !== undefined)
      expect(last?.layersA).toEqual([])
      expect(last?.layersB).toEqual(['tp'])
    })
    // No raw-name row lingers in the sidebar for the vanished layer.
    expect(screen.getByText('2t', { exact: true }).elements()).toHaveLength(0)
  })

  it('keeps the clip window on the same instants when the axis grows', async () => {
    const portA = nextPort++
    const portB = nextPort++
    const early = '2026-07-05T18:00:00Z'
    registerMockWmsServer(portA, {
      layers: [
        {
          name: '2t',
          title: '2 m temperature',
          time: '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z',
        },
        { name: 'msl', title: 'Mean sea level pressure', time: early },
      ],
    })
    registerMockWmsServer(portB, {
      layers: [
        {
          name: '2t',
          title: '2 m temperature',
          time: '2026-07-06T06:00:00Z,2026-07-06T12:00:00Z',
        },
        { name: 'msl', title: 'Mean sea level pressure', time: early },
      ],
    })
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()

    // Window T00–T06 (A's current range).
    await screen.getByTitle('Clip to A’s time range').click()
    await expect.element(screen.getByText(/1 \/ 2/)).toBeVisible()

    // A layer at T−6 h prepends an axis step. Index-kept bounds would
    // slide the window to T−6–T00; epoch-kept bounds stay on T00–T06.
    await screen.getByText('Mean sea level pressure').first().click()
    await expect
      .element(screen.getByText('2026-07-06 00:00Z – 2026-07-06 06:00Z'))
      .toBeVisible()
    await expect.element(screen.getByText(/1 \/ 2/)).toBeVisible()
    await expect.element(screen.getByText('(4)')).toBeVisible()
  })

  it('resets pair-tuned time linking when a slot gets a different source', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByLabelText('Time link mode').click()
    await screen
      .getByRole('option', { name: 'Time offset (B = A + Δ)' })
      .click()
    await screen.getByRole('button', { name: 'Align starts' }).click()
    await expect.element(screen.getByText('B +6 h')).toBeVisible()

    // A different B: Δ was tuned for the old pair — back to exact.
    const portB2 = nextPort++
    registerMockWmsServer(portB2, {
      layers: [
        {
          name: '2t',
          title: '2 m temperature',
          time: '2026-07-06T06:00:00Z,2026-07-06T12:00:00Z',
        },
      ],
    })
    await screen.rerender(<Harness portA={portA} portB={portB2} />)
    await expect
      .element(screen.getByLabelText('Time link mode'))
      .toHaveTextContent('Same time (exact)')
    expect(screen.getByText('B +6 h').elements()).toHaveLength(0)
  })

  it('keeps the offset when the SAME B is removed and re-added', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={true} />,
    )
    await screen.getByText('2 m temperature').first().click()

    await screen.getByLabelText('Time link mode').click()
    await screen
      .getByRole('option', { name: 'Time offset (B = A + Δ)' })
      .click()
    await screen.getByRole('button', { name: 'Align starts' }).click()
    await expect.element(screen.getByText('B +6 h')).toBeVisible()

    // Remove B (solo renders as exact), then bring the same source back.
    await screen.rerender(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )
    expect(screen.getByText('B +6 h').elements()).toHaveLength(0)
    await screen.rerender(
      <ProgressiveHarness portA={portA} portB={portB} withB={true} />,
    )
    await expect.element(screen.getByText('B +6 h')).toBeVisible()
  })

  it('pinned legends and focus follow their source through a swap', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    // Pin A's legend, focus B.
    await screen
      .getByRole('button', { name: 'Pin legend open' })
      .first()
      .click()
    await expect
      .element(screen.getByTitle('A · 2 m temperature'))
      .toBeInTheDocument()
    await screen.getByRole('button', { name: 'View only B' }).click()

    // Swap: both stay with their sources, now in the other slots.
    await screen.getByRole('button', { name: 'swap slots' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'View only A' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(screen.getByTitle('B · 2 m temperature'))
      .toBeInTheDocument()
    expect(screen.getByTitle('A · 2 m temperature').elements()).toHaveLength(0)
  })

  it('clips the timeline to a source range via presets', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    // Union of T00/T06 (A) and T06/T12 (B) → 3 steps, full window.
    await expect.element(screen.getByText('1 / 3')).toBeVisible()

    // Clip to A's range (T00–T06) → the window is 2 steps, stepper wraps
    // inside it and never reaches B-only T12.
    await screen.getByTitle('Clip to A’s time range').click()
    await expect.element(screen.getByText(/1 \/ 2/)).toBeVisible()
    const next = screen.getByRole('button', { name: 'Next time step' })
    await next.click()
    await expect.element(screen.getByText(/2 \/ 2/)).toBeVisible()
    await next.click()
    await expect.element(screen.getByText(/1 \/ 2/)).toBeVisible()

    // Back to the full union.
    await screen
      .getByRole('button', { name: 'All', exact: true })
      .last()
      .click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
  })

  it('nearest time-link snaps within tolerance and tags the offset', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [
        {
          name: '2t',
          title: '2 m temperature',
          time: '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z',
        },
      ],
    })
    // B runs on an hour-shifted rhythm — classic external-server case.
    registerMockWmsServer(portB, {
      layers: [
        {
          name: '2t',
          title: '2 m temperature',
          time: '2026-07-06T01:00:00Z,2026-07-06T07:00:00Z',
        },
      ],
    })
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    // Exact mode: B has nothing at T00 → hidden with a gap badge.
    await expect
      .element(screen.getByText('No data at this time — B'))
      .toBeVisible()

    // Switch to nearest: B snaps to T01 and shows an honest "+1 h" tag.
    await screen.getByLabelText('Time link mode').click()
    await screen.getByRole('option', { name: 'Nearest time' }).click()
    await expect.element(screen.getByText('B +1 h')).toBeVisible()
    expect(
      screen.getByText('No data at this time — B').elements(),
    ).toHaveLength(0)
  })

  it('offset mode offers a slider with alignment presets synced to the field', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByLabelText('Time link mode').click()
    await screen
      .getByRole('option', { name: 'Time offset (B = A + Δ)' })
      .click()

    const slider = screen.getByRole('slider', {
      name: 'Time offset between A and B',
    })
    await expect.element(slider).toBeInTheDocument()

    // "Align starts" = B.first − A.first = +6 h; the panel tag and the
    // hours field both follow.
    await screen.getByRole('button', { name: 'Align starts' }).click()
    await expect.element(screen.getByText('B +6 h')).toBeVisible()
    const hours = screen.getByRole('textbox').first()
    await expect.element(hours).toHaveValue('6')

    // Reset preset returns to zero.
    await screen.getByRole('button', { name: '0', exact: true }).click()
    await expect.element(hours).toHaveValue('0')
    expect(screen.getByText('B +6 h').elements()).toHaveLength(0)
  })

  it('auto-unlinks with a notice when the sources share no layers', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    registerMockWmsServer(portB, {
      layers: [{ name: 'tp', title: 'Total precipitation' }],
    })
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await expect
      .element(
        screen.getByText(
          'The two sources share no common layers — selection is per panel.',
        ),
      )
      .toBeVisible()
    // Link switch reflects + is disabled.
    await expect
      .element(screen.getByRole('switch', { name: /link layer selection/i }))
      .toBeDisabled()
    // Per-panel selection browses one catalog at a time: just A | B —
    // no "All" (two unrelated catalogs) and no "A∩B" (empty by definition).
    expect(
      screen.getByRole('button', { name: 'All', exact: true }).elements(),
    ).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'A∩B' }).elements()).toHaveLength(
      0,
    )
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    expect(screen.getByText('Total precipitation').elements()).toHaveLength(0)
    await screen.getByRole('button', { name: 'B', exact: true }).click()
    await expect.element(screen.getByText('Total precipitation')).toBeVisible()
    expect(screen.getByText('2 m temperature').elements()).toHaveLength(0)

    // Swap B for a source that DOES share layers → the situational
    // unlink undoes itself: banner gone, pair filter back.
    const portB2 = nextPort++
    registerMockWmsServer(portB2, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    await screen.rerender(<Harness portA={portA} portB={portB2} />)
    await expect
      .element(screen.getByRole('button', { name: 'A∩B' }))
      .toBeVisible()
    expect(
      screen
        .getByText(
          'The two sources share no common layers — selection is per panel.',
        )
        .elements(),
    ).toHaveLength(0)
    await expect
      .element(screen.getByRole('switch', { name: /link layer selection/i }))
      .toBeEnabled()
  })
})

/** Same pair, but B mounts only when `withB` flips — the progressive
 *  single→comparison transition. */
function ProgressiveViewerRoute({
  portA,
  portB,
  withB,
}: {
  portA: number
  portB: number
  withB: boolean
}) {
  const [mode, setMode] = useState<CompareMode>('swipe')
  return (
    <div style={{ width: 1100, height: 700 }}>
      <GeoViewer
        a={{
          id: `run:test-${portA}`,
          baseUrl: `http://localhost:${portA}`,
          label: 'Run A',
        }}
        b={
          withB
            ? {
                id: `run:test-${portB}`,
                baseUrl: `http://localhost:${portB}`,
                label: 'Run B',
              }
            : null
        }
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  )
}

function ProgressiveHarness(props: {
  portA: number
  portB: number
  withB: boolean
}) {
  return (
    <RouterHarness>{() => <ProgressiveViewerRoute {...props} />}</RouterHarness>
  )
}

describe('GeoViewer solo', () => {
  it('runs with a single source: no comparison controls, layers work', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )

    // A's layers are browsable; comparison affordances are absent.
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Swipe' }).elements(),
    ).toHaveLength(0)
    expect(
      screen.getByRole('switch', { name: /link layer selection/i }).elements(),
    ).toHaveLength(0)
    expect(
      screen
        .getByRole('slider', { name: 'Availability for source B' })
        .elements(),
    ).toHaveLength(0)
    // Plain copy button — the per-slot menu is comparison-only.
    expect(
      screen.getByRole('button', { name: 'Copy options' }).elements(),
    ).toHaveLength(0)

    // Activating a layer builds A's own timeline (T00, T06).
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 2')).toBeVisible()
    await expect
      .element(
        screen.getByRole('slider', { name: 'Availability for source A' }),
      )
      .toBeInTheDocument()
    // Global opacity stays; the per-source tier is comparison-only.
    await expect
      .element(screen.getByRole('slider', { name: /Global opacity/ }))
      .toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /All of A/ }).elements(),
    ).toHaveLength(0)
  })

  it('keeps selection and time when B arrives; comparison controls appear', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 2')).toBeVisible()

    await screen.rerender(
      <ProgressiveHarness portA={portA} portB={portB} withB />,
    )

    // Mode switcher and link toggle materialize in place.
    await expect
      .element(screen.getByRole('button', { name: 'Swipe' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('switch', { name: /link layer selection/i }))
      .toBeInTheDocument()
    // Union timeline (T00,T06,T12) keeps the selected instant, and the
    // solo selection projects onto B — its T00 gap badge proves both.
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
    await expect
      .element(screen.getByText('No data at this time — B'))
      .toBeVisible()
  })
})

describe('GeoViewer preload', () => {
  it('offers the preload toggle once a timeline exists', async () => {
    const { portA, portB } = registerDefaultPair()
    const removeSizing = injectMapSizing()
    try {
      const screen = await render(<Harness portA={portA} portB={portB} />)

      // No time-aware selection yet — no toggle.
      expect(
        screen.getByRole('switch', { name: 'Preload time steps' }).elements(),
      ).toHaveLength(0)

      await screen.getByText('2 m temperature').first().click()
      const toggle = screen.getByRole('switch', { name: 'Preload time steps' })
      await expect.element(toggle).toBeInTheDocument()
      // The current instant (T00) loads; neighbours wait for the toggle.
      await expect
        .poll(() => getMapRequests(portA).length, { timeout: 8000 })
        .toBeGreaterThan(0)
      expect(getMapRequests(portA)).not.toContain('2026-07-06T06:00:00Z')

      // Programmatic click — the unstyled switch has no box to aim at.
      ;(toggle.element() as HTMLElement).click()
      await expect.element(toggle).toBeChecked()
      // Warm-up actually fetches the OTHER advertised step of A's 2t.
      await expect
        .poll(() => getMapRequests(portA), { timeout: 8000 })
        .toContain('2026-07-06T06:00:00Z')
    } finally {
      removeSizing()
    }
  })
})

describe('GeoViewer reorder', () => {
  it('drag-reorders active pairs in the stacking order', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    // Activate two pairs; the newest lands on top: [msl, 2t].
    await screen.getByText('2 m temperature').first().click()
    await screen.getByText('Mean sea level pressure').first().click()

    const cardOrder = () =>
      screen
        .getByRole('button', { name: /^Remove / })
        .elements()
        .map((el) => el.getAttribute('aria-label'))
    expect(cardOrder()).toEqual([
      'Remove Mean sea level pressure',
      'Remove 2 m temperature',
    ])

    // Native drag: card 0 dropped onto card 1.
    const grips = screen.getByTitle('Drag to reorder').elements()
    const dt = new DataTransfer()
    grips[0]
      .closest('[draggable]')!
      .dispatchEvent(
        new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }),
      )
    grips[1]
      .closest('li')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))

    await expect
      .poll(() => cardOrder())
      .toEqual(['Remove 2 m temperature', 'Remove Mean sea level pressure'])
  })

  it('ignores foreign drags (no phantom "move index 0")', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByText('2 m temperature').first().click()
    await screen.getByText('Mean sea level pressure').first().click()

    const cardOrder = () =>
      screen
        .getByRole('button', { name: /^Remove / })
        .elements()
        .map((el) => el.getAttribute('aria-label'))
    const before = cardOrder()

    // A text/file drag carries no pair mime — Number('') would be 0.
    const grips = screen.getByTitle('Drag to reorder').elements()
    const dt = new DataTransfer()
    dt.setData('text/plain', 'not ours')
    grips[1]
      .closest('li')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))

    await new Promise((r) => setTimeout(r, 300))
    expect(cardOrder()).toEqual(before)
  })

  it('reorders via the keyboard-accessible move buttons, disabled at bounds', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByText('2 m temperature').first().click()
    await screen.getByText('Mean sea level pressure').first().click()

    const cardOrder = () =>
      screen
        .getByRole('button', { name: /^Remove / })
        .elements()
        .map((el) => el.getAttribute('aria-label'))
    expect(cardOrder()).toEqual([
      'Remove Mean sea level pressure',
      'Remove 2 m temperature',
    ])

    // Boundary rows offer only the inward direction.
    await expect
      .element(
        screen.getByRole('button', { name: 'Move Mean sea level pressure up' }),
      )
      .toBeDisabled()
    await expect
      .element(
        screen.getByRole('button', { name: 'Move 2 m temperature down' }),
      )
      .toBeDisabled()

    await screen
      .getByRole('button', { name: 'Move 2 m temperature up' })
      .click()
    await expect
      .poll(() => cardOrder())
      .toEqual(['Remove 2 m temperature', 'Remove Mean sea level pressure'])
  })
})

describe('GeoViewer legend pinning', () => {
  it('pins a legend to the map strip and unpins from it', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()

    // Pin A's legend from the pair card → the strip appears on the map.
    await screen
      .getByRole('button', { name: 'Pin legend open' })
      .first()
      .click()
    await expect.element(screen.getByText('A · 2 m temperature')).toBeVisible()

    await screen.getByRole('button', { name: 'Unpin legend' }).last().click()
    expect(screen.getByText('A · 2 m temperature').elements()).toHaveLength(0)
  })
})

describe('GeoViewer layer browser grouping', () => {
  it('clusters repetitive catalog titles into prefix groups', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [
        { name: 'at2i', title: 'Air temperature 2m indexed' },
        { name: 'at2m', title: 'Air temperature 2m max' },
        { name: 'atpl', title: 'Air temperature pl in AIFS' },
        { name: 'atfl', title: 'Air temperature fl in MEPS' },
        { name: 'ws', title: 'Wind speed 10m' },
      ],
    })
    registerMockWmsServer(portB, { layers: [] })
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )

    // Grouping is off by default — enable it to cluster the titles.
    await expect.element(screen.getByText('Wind speed 10m')).toBeVisible()
    await screen.getByRole('button', { name: 'Group similar layers' }).click()

    // Group header with the shared prefix and a count; children hidden.
    await expect
      .element(screen.getByText('Air temperature', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText('4 layers')).toBeVisible()
    await expect.element(screen.getByText('Wind speed 10m')).toBeVisible()
    expect(screen.getByText('2m indexed').elements()).toHaveLength(0)

    // Expanding shows suffix-only rows; activating uses the full title.
    await screen.getByText('Air temperature', { exact: true }).click()
    await screen.getByText('2m indexed').click()
    await expect
      .element(
        screen.getByRole('slider', {
          name: /Air temperature 2m indexed opacity/,
        }),
      )
      .toBeInTheDocument()
  })

  it('the group toggle clusters flat full-title rows on demand', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [
        { name: 'at2i', title: 'Air temperature 2m indexed' },
        { name: 'at2m', title: 'Air temperature 2m max' },
        { name: 'atpl', title: 'Air temperature pl in AIFS' },
        { name: 'ws', title: 'Wind speed 10m' },
      ],
    })
    registerMockWmsServer(portB, { layers: [] })
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )

    // Flat by default: full titles, no group header.
    await expect
      .element(screen.getByText('Air temperature 2m indexed'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Air temperature pl in AIFS'))
      .toBeVisible()
    expect(screen.getByText('3 layers').elements()).toHaveLength(0)

    // Toggle clusters them under the shared prefix.
    await screen.getByRole('button', { name: 'Group similar layers' }).click()
    await expect.element(screen.getByText('3 layers')).toBeVisible()
  })
})

describe('GeoViewer measure tool', () => {
  it('shows a hint while armed; × removes one measurement; Esc exits', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByRole('button', { name: 'Measure distance' }).click()
    await expect
      .element(screen.getByText(/double-click to finish/).first())
      .toBeVisible()

    const map = document.querySelector('.ol-viewport')
    expect(map).not.toBeNull()
    const container = (map as HTMLElement).parentElement!
    container.style.cssText = 'position:relative;width:800px;height:400px'
    ;(map as HTMLElement).scrollIntoView({ block: 'center' })
    const viewport = page.elementLocator(map as Element)
    await viewport.click({ position: { x: 150, y: 200 } })
    await viewport.dblClick({ position: { x: 300, y: 200 } })

    const remove = screen.getByRole('button', {
      name: 'Remove this measurement',
    })
    await expect.element(remove).toBeVisible()
    ;(remove.element() as HTMLElement).click()
    await expect.poll(() => remove.elements().length).toBe(0)

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    await expect
      .poll(() => screen.getByText(/double-click to finish/).elements().length)
      .toBe(0)
  })

  it('rectangle shape: two opposite corners make a measured box', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByRole('button', { name: 'Area shape options' }).click()
    await screen.getByRole('menuitem', { name: 'Rectangle area' }).click()
    await expect
      .element(screen.getByText(/two opposite corners/).first())
      .toBeVisible()

    const map = document.querySelector('.ol-viewport')
    expect(map).not.toBeNull()
    const container = (map as HTMLElement).parentElement!
    container.style.cssText = 'position:relative;width:800px;height:400px'
    ;(map as HTMLElement).scrollIntoView({ block: 'center' })
    const viewport = page.elementLocator(map as Element)
    await viewport.click({ position: { x: 150, y: 150 } })
    await viewport.click({ position: { x: 300, y: 250 } })

    await expect
      .element(screen.getByRole('button', { name: 'Remove this measurement' }))
      .toBeVisible()
  })
})

describe('GeoViewer route-leave guard', () => {
  it('blocks leaving with annotations; offers export; Leave discards', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"],[data-slot="alert-dialog-content"]{position:fixed;top:0;left:0;z-index:50}'
    document.head.appendChild(style)

    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)

    await screen.getByRole('button', { name: /Annotate/ }).click()
    await screen.getByText('2 m temperature').first().click()
    const map = document.querySelector('.ol-viewport')
    expect(map).not.toBeNull()
    const container = (map as HTMLElement).parentElement!
    container.style.cssText = 'position:relative;width:800px;height:400px'
    ;(map as HTMLElement).scrollIntoView({ block: 'center' })
    await page
      .elementLocator(map as Element)
      .click({ position: { x: 200, y: 200 } })
    await screen.getByPlaceholder('Record your finding…').fill('keep me')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(screen.getByText('keep me')).toBeVisible()

    // Same-route search changes (slot/mode) must pass without the guard.
    await screen.getByRole('button', { name: 'tweak search' }).click()
    await new Promise((r) => setTimeout(r, 300))
    expect(
      screen.getByText('Leave with unsaved annotations?').elements(),
    ).toHaveLength(0)
    await expect.element(screen.getByText('keep me')).toBeVisible()

    // Leaving is blocked; Export offers the manual backup.
    await screen.getByRole('button', { name: 'go away' }).click()
    await expect
      .element(screen.getByText('Leave with unsaved annotations?'))
      .toBeVisible()
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    ;(
      screen
        .getByRole('button', { name: 'Export GeoJSON' })
        .element() as HTMLElement
    ).click()
    expect(urlSpy).toHaveBeenCalledOnce()

    // Stay keeps the viewer intact; Leave discards and navigates.
    ;(
      screen.getByRole('button', { name: 'Stay' }).element() as HTMLElement
    ).click()
    await expect.element(screen.getByText('keep me')).toBeVisible()
    await screen.getByRole('button', { name: 'go away' }).click()
    const leave = screen.getByRole('button', { name: 'Leave', exact: true })
    await expect.element(leave).toBeVisible()
    ;(leave.element() as HTMLElement).click()
    await expect.element(screen.getByText('Away page')).toBeVisible()

    style.remove()
  })
})

describe('GeoViewer responsive layout', () => {
  it('auto-collapses both sidebars below lg; handles reopen them', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()

    try {
      await page.viewport(900, 700)
      await expect
        .poll(
          () =>
            screen.getByRole('button', { name: 'Expand sidebar' }).elements()
              .length,
        )
        .toBe(2)

      // Manual reopen still works below the breakpoint (right = browser).
      ;(
        screen
          .getByRole('button', { name: 'Expand sidebar' })
          .elements()[1] as HTMLElement
      ).click()
      await expect
        .element(screen.getByText('2 m temperature').first())
        .toBeVisible()

      await page.viewport(1280, 800)
      await expect
        .poll(
          () =>
            screen.getByRole('button', { name: 'Expand sidebar' }).elements()
              .length,
        )
        .toBe(0)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('below lg: one modal sheet at a time; the scrim closes it', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()

    const handles = () =>
      screen
        .getByRole('button', { name: 'Expand sidebar' })
        .elements() as Array<HTMLElement>
    try {
      // Phone and tablet share the sheet behavior.
      for (const width of [500, 900]) {
        await page.viewport(width, 800)
        await expect.poll(() => handles().length).toBe(2)

        // Open left, then right — the sheets swap, never coexist.
        handles()[0].click()
        await expect.poll(() => handles().length).toBe(1)
        handles()[0].click()
        await expect.poll(() => handles().length).toBe(1)

        // Scrim tap closes the open sheet — both handles return.
        ;(
          document.querySelector('[data-testid="sidebar-scrim"]') as HTMLElement
        ).click()
        await expect.poll(() => handles().length).toBe(2)
      }
    } finally {
      await page.viewport(1280, 900)
    }
  })
})

describe('GeoViewer accessibility', () => {
  it('axe: no serious violations in the active comparison viewer', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()

    const results = await axe.run(document.body, {
      // Unstyled test env — color contrast is meaningless here.
      rules: { 'color-contrast': { enabled: false } },
    })
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(
      serious.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([])
  })

  it("keyboard: track slider steps through one source's instants", async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()

    // B covers only T06/T12 of the union: End/ArrowLeft skip steps B lacks.
    const track = screen.getByRole('slider', {
      name: 'Availability for source B',
    })
    const el = track.element() as HTMLElement
    el.focus()
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }),
    )
    await expect.element(screen.getByText('3 / 3')).toBeVisible()
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }),
    )
    await expect.element(screen.getByText('2 / 3')).toBeVisible()
  })

  it('latches the loupe from the toolbar (keyboard/touch path)', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(<Harness portA={portA} portB={portB} />)
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()

    const latch = screen.getByRole('button', { name: 'Magnifier on' })
    await latch.click()
    await expect.element(latch).toHaveAttribute('aria-pressed', 'true')
    await latch.click()
    await expect.element(latch).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('GeoViewer URL view state', () => {
  it('restores layers and the valid-time instant from the URL', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <Harness
        portA={portA}
        portB={portB}
        initialViewState={{
          layersA: ['2t'],
          layersB: ['2t'],
          timeMs: Date.parse('2026-07-06T06:00:00Z'),
        }}
      />,
    )

    // The 2t pair activates without a click; T06 = step 2 of the union.
    await expect.element(screen.getByText('2 / 3')).toBeVisible()
    expect(screen.getByText(/No data at this time/).elements()).toHaveLength(0)
  })

  it('restores an unlinked per-side selection', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <Harness
        portA={portA}
        portB={portB}
        initialViewState={{ unlinkedLayers: true, layersA: ['tp'] }}
      />,
    )

    await expect
      .element(screen.getByRole('switch', { name: /link layer selection/i }))
      .not.toBeChecked()
    // tp (A-only) is active: its stack shows the static badge, B's empty.
    await expect
      .element(screen.getByText('Total precipitation').first())
      .toBeVisible()
  })

  it('never reports an auto-unlink as a manual choice', async () => {
    const portA = nextPort++
    const portB = nextPort++
    registerMockWmsServer(portA, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    registerMockWmsServer(portB, {
      layers: [{ name: 'tp', title: 'Total precipitation' }],
    })
    const reports: Array<Partial<ViewerUrlState>> = []
    const screen = await render(
      <Harness
        portA={portA}
        portB={portB}
        onViewStateChange={(partial) => reports.push(partial)}
      />,
    )

    // Zero overlap → auto-unlink kicks in…
    await expect
      .element(
        screen.getByText(
          'The two sources share no common layers — selection is per panel.',
        ),
      )
      .toBeVisible()
    // …but the URL must not pin it (restoring manual unlink blocks relink).
    expect(reports.some((r) => r.unlinkedLayers === true)).toBe(false)
  })

  it('reports layer and time changes for the URL write-back', async () => {
    const { portA, portB } = registerDefaultPair()
    const reports: Array<Partial<ViewerUrlState>> = []
    const screen = await render(
      <Harness
        portA={portA}
        portB={portB}
        onViewStateChange={(partial) => reports.push(partial)}
      />,
    )

    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
    await vi.waitFor(() => {
      const last = [...reports].reverse().find((r) => r.layersA !== undefined)
      expect(last?.layersA).toEqual(['2t'])
      expect(last?.timeMs).toBe(Date.parse('2026-07-06T00:00:00Z'))
    })

    await screen.getByRole('button', { name: 'Next time step' }).click()
    await vi.waitFor(() => {
      const last = [...reports].reverse().find((r) => r.timeMs !== undefined)
      expect(last?.timeMs).toBe(Date.parse('2026-07-06T06:00:00Z'))
    })
  })
})
