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
 * CommandPalette Unit Tests
 *
 * Covers the Base UI Autocomplete command palette: open/close rendering,
 * grouping, label + keyword filtering, the empty state, shortcut keycaps, the
 * footer, pointer selection, keyboard selection (Enter and Tab), and the
 * ⌘K/Ctrl+K shortcut wiring.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { renderWithRouter } from '@tests/utils/render'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandStore } from '@/stores/commandStore'

// Stable navigate spy (the `mock` prefix is required for vi.mock factory refs)
// so command actions can be asserted across renders.
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const PLACEHOLDER = 'Type a command or search...'

/** Every command label, grouped, for exhaustive presence checks. */
const ALL_COMMANDS = [
  'Quick Start',
  'Standard Forecast',
  'Custom Model Forecast',
  'Dataset Forecast',
  'Dashboard',
  'Configure',
  'Execute',
  'Visualise',
  'Admin',
]

function renderPalette() {
  return renderWithRouter(
    <HotkeysProvider>
      <CommandPalette />
    </HotkeysProvider>,
  )
}

describe('CommandPalette', () => {
  // Browser-mode tests render without the app stylesheet, so the dialog loses
  // its Tailwind `fixed`/`z-50` positioning while Base UI's modal backdrop
  // keeps its inline `position: fixed`. Restore the dialog's production
  // stacking so the backdrop can't paint over the popup and swallow clicks.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;z-index:50}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    // Shared zustand stores are reset globally in tests/setup.ts; only the
    // local navigate spy needs clearing between tests.
    mockNavigate.mockClear()
  })

  it('renders nothing while the store is closed', async () => {
    const screen = await renderPalette()

    await expect
      .element(screen.getByPlaceholder(PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('lists every command grouped by category once opened', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await expect.element(screen.getByPlaceholder(PLACEHOLDER)).toBeVisible()

    // Both category headings render.
    await expect.element(screen.getByText('Getting Started')).toBeVisible()
    await expect.element(screen.getByText('Navigation')).toBeVisible()

    // Every command is present as a selectable option.
    for (const label of ALL_COMMANDS) {
      await expect
        .element(screen.getByRole('option', { name: new RegExp(label) }))
        .toBeVisible()
    }
  })

  it('renders each shortcut key as a keycap', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    // Dashboard is bound to `g d` — shown as two keycaps within its option.
    const dashboard = screen.getByRole('option', { name: /Dashboard/ })
    await expect
      .element(dashboard.getByText('G', { exact: true }))
      .toBeVisible()
    await expect
      .element(dashboard.getByText('D', { exact: true }))
      .toBeVisible()
  })

  it('shows a footer with the palette controls', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await expect.element(screen.getByText('navigate')).toBeVisible()
    await expect.element(screen.getByText('select')).toBeVisible()
    await expect.element(screen.getByText('close')).toBeVisible()
  })

  it('filters commands by label as the user types', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await screen.getByPlaceholder(PLACEHOLDER).fill('dashboard')

    await expect
      .element(screen.getByRole('option', { name: /Dashboard/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: /Quick Start/ }))
      .not.toBeInTheDocument()
  })

  it('filters by keyword aliases, not just the visible label', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    // "journal" is a keyword of the Execute command — it appears in
    // neither its label nor its description.
    await screen.getByPlaceholder(PLACEHOLDER).fill('journal')

    await expect
      .element(screen.getByRole('option', { name: /Execute/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: /Dashboard/ }))
      .not.toBeInTheDocument()
  })

  it('shows the empty state when nothing matches', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await screen.getByPlaceholder(PLACEHOLDER).fill('zzz-no-such-command')

    await expect.element(screen.getByText('No results found.')).toBeVisible()
    await expect.element(screen.getByRole('option')).not.toBeInTheDocument()
  })

  it('runs the command action and closes the palette on click', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await screen.getByRole('option', { name: /Dashboard/ }).click()

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/overview' })
    expect(useCommandStore.getState().isOpen).toBe(false)
  })

  it('passes the preset search param through for Getting Started commands', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    await screen.getByRole('option', { name: /Quick Start/ }).click()

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      search: { preset: 'quick-start' },
    })
  })

  it('runs the highlighted command when Enter is pressed', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    // autoHighlight="always" keeps the top filtered item highlighted, so
    // narrowing to a single result and pressing Enter runs exactly it.
    await screen.getByPlaceholder(PLACEHOLDER).fill('executions')
    await userEvent.keyboard('{Enter}')

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/execute' })
    expect(useCommandStore.getState().isOpen).toBe(false)
  })

  it('runs the highlighted command when Tab is pressed', async () => {
    useCommandStore.getState().setOpen(true)
    const screen = await renderPalette()

    // Tab confirms the highlighted command, mirroring Enter.
    await screen.getByPlaceholder(PLACEHOLDER).fill('admin')
    await userEvent.keyboard('{Tab}')

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/admin' })
    expect(useCommandStore.getState().isOpen).toBe(false)
  })

  it('opens the palette when the Ctrl+K shortcut is pressed', async () => {
    await renderPalette()
    expect(useCommandStore.getState().isOpen).toBe(false)

    await userEvent.keyboard('{Control>}k{/Control}')

    expect(useCommandStore.getState().isOpen).toBe(true)
  })

  it('store starts closed and can be opened and closed', () => {
    expect(useCommandStore.getState().isOpen).toBe(false)

    useCommandStore.getState().setOpen(true)
    expect(useCommandStore.getState().isOpen).toBe(true)

    useCommandStore.getState().setOpen(false)
    expect(useCommandStore.getState().isOpen).toBe(false)
  })
})
