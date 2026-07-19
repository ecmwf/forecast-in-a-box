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
 * CompareViewer integration tests — two mock WMS servers, asserting on
 * controls and state (never canvas pixels): mode switcher, linked pairing
 * with availability chips, add-to-both, union timeline with gap badges,
 * swipe divider a11y, flicker toggle, zero-overlap auto-unlink.
 */

import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import { registerMockWmsServer } from '@tests/../mocks/data/wms.data'
import type { CompareMode } from '@/features/viewer/compare/types'
import { CompareViewer } from '@/features/viewer/compare/CompareViewer'
import i18n from '@/lib/i18n'

let nextPort = 19800

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

function Harness({
  portA,
  portB,
  initialMode = 'swipe',
}: {
  portA: number
  portB: number
  initialMode?: CompareMode
}) {
  const [mode, setMode] = useState<CompareMode>(initialMode)
  return (
    <I18nextProvider i18n={i18n}>
      <div style={{ width: 1100, height: 700 }}>
        <CompareViewer
          a={{ baseUrl: `http://localhost:${portA}`, label: 'Run A' }}
          b={{ baseUrl: `http://localhost:${portB}`, label: 'Run B' }}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </I18nextProvider>
  )
}

describe('CompareViewer', () => {
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
    // Loupe hint is visible for single-map modes.
    await expect.element(screen.getByText('Hold Z to magnify')).toBeVisible()
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

    // 2 → side-by-side (both slot tags visible as separate panels).
    press('2')
    await expect
      .element(screen.getByRole('button', { name: /side by side/i }))
      .toHaveAttribute('aria-pressed', 'true')
    press('1')
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
      .element(screen.getByRole('button', { name: /Sentinel-2 cloudless/ }))
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
      '[data-slot="dialog-content"]{position:fixed;z-index:50}'
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
    // x=200 keeps clear of the swipe divider at the 50% mark.
    await viewport.click({ position: { x: 200, y: 200 } })
    await expect.element(screen.getByText('Annotation 1')).toBeVisible()
    await screen
      .getByPlaceholder('Record your finding…')
      .fill('Deep low over the gulf')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Listed in the left sidebar with its number.
    await expect
      .element(screen.getByText('Deep low over the gulf'))
      .toBeVisible()

    // Edit via the list, then delete from the editor.
    await screen.getByText('Deep low over the gulf').click()
    await expect.element(screen.getByText('Annotation 1')).toBeVisible()
    await screen.getByRole('button', { name: 'Delete' }).click()
    await expect
      .element(screen.getByText('Deep low over the gulf'))
      .not.toBeInTheDocument()
  })

  it('annotates per panel in side-by-side mode', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;z-index:50}'
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
    await expect.element(screen.getByText('Annotation 1')).toBeVisible()
    await screen.getByPlaceholder('Record your finding…').fill('B-side eddy')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Listed with the B slot badge.
    await expect.element(screen.getByText('B-side eddy')).toBeVisible()
    await expect
      .element(screen.getByTitle('B', { exact: true }))
      .toBeInTheDocument()
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
    // Per-source sections list each side's own layers.
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    await expect.element(screen.getByText('Total precipitation')).toBeVisible()
    // A∩B with zero overlap → explicit empty panel, not a full listing.
    await screen.getByRole('button', { name: 'A∩B' }).click()
    await expect
      .element(screen.getByText('No layers are available in both sources.'))
      .toBeVisible()
    expect(screen.getByText('2 m temperature').elements()).toHaveLength(0)
  })
})

/** Same pair, but B mounts only when `withB` flips — the progressive
 *  single→comparison transition. */
function ProgressiveHarness({
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
    <I18nextProvider i18n={i18n}>
      <div style={{ width: 1100, height: 700 }}>
        <CompareViewer
          a={{ baseUrl: `http://localhost:${portA}`, label: 'Run A' }}
          b={
            withB
              ? { baseUrl: `http://localhost:${portB}`, label: 'Run B' }
              : null
          }
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </I18nextProvider>
  )
}

describe('CompareViewer solo', () => {
  it('runs with a single source: no comparison controls, layers work', async () => {
    const { portA, portB } = registerDefaultPair()
    const screen = await render(
      <ProgressiveHarness portA={portA} portB={portB} withB={false} />,
    )

    // A's layers are browsable; comparison affordances are absent.
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    await expect.element(screen.getByText('Compare…')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Swipe' }).elements(),
    ).toHaveLength(0)
    expect(screen.getByRole('switch').elements()).toHaveLength(0)
    expect(
      screen.getByRole('img', { name: 'Availability for source B' }).elements(),
    ).toHaveLength(0)

    // Activating a layer builds A's own timeline (T00, T06).
    await screen.getByText('2 m temperature').first().click()
    await expect.element(screen.getByText('1 / 2')).toBeVisible()
    await expect
      .element(screen.getByRole('img', { name: 'Availability for source A' }))
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
    await expect.element(screen.getByRole('switch')).toBeInTheDocument()
    // Union timeline (T00,T06,T12) keeps the selected instant, and the
    // solo selection projects onto B — its T00 gap badge proves both.
    await expect.element(screen.getByText('1 / 3')).toBeVisible()
    await expect
      .element(screen.getByText('No data at this time — B'))
      .toBeVisible()
  })
})
