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
 * Tests the command palette component including:
 * - Open/close behavior via store
 * - Command groups rendering
 * - Keyboard shortcut integration
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandStore } from '@/stores/commandStore'

// Mock TanStack Router's useNavigate
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

describe('CommandPalette', () => {
  beforeEach(() => {
    useCommandStore.getState().reset()
  })

  it('renders nothing visible when store isOpen is false', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    // The dialog should not show command content when closed
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .not.toBeInTheDocument()
  })

  it('shows command groups when opened via store', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    // Open the palette
    useCommandStore.getState().setOpen(true)

    // Search input should be visible
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .toBeVisible()

    // Command groups should be visible
    await expect.element(screen.getByText('Getting Started')).toBeVisible()
    await expect.element(screen.getByText('Navigation')).toBeVisible()
  })

  it('shows navigation commands', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    useCommandStore.getState().setOpen(true)

    // Navigation commands should be visible (use exact to avoid matching descriptions)
    await expect
      .element(screen.getByText('Dashboard', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Configure', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Executions', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Admin', { exact: true }))
      .toBeVisible()
  })

  it('shows getting started commands', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    useCommandStore.getState().setOpen(true)

    // Getting Started commands should be visible
    await expect.element(screen.getByText('Quick Start')).toBeVisible()
    await expect.element(screen.getByText('Standard Forecast')).toBeVisible()
  })

  it('shows "No results found" for non-matching search', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    useCommandStore.getState().setOpen(true)

    // Type a search that matches nothing
    const input = screen.getByPlaceholder('Type a command or search...')
    await input.fill('zzzznonexistent')

    await expect.element(screen.getByText('No results found.')).toBeVisible()
  })

  it('opens palette on Cmd+K keyboard shortcut', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    // Palette should be closed initially
    expect(useCommandStore.getState().isOpen).toBe(false)

    // Simulate Cmd+K
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    )

    // Store should now be open
    expect(useCommandStore.getState().isOpen).toBe(true)

    // Content should be visible
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .toBeVisible()
  })

  it('opens palette on Ctrl+K keyboard shortcut', async () => {
    await renderWithRouter(<CommandPalette />)

    // Simulate Ctrl+K
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
    )

    expect(useCommandStore.getState().isOpen).toBe(true)
  })

  it('toggles palette closed on repeated Cmd+K', async () => {
    const screen = await renderWithRouter(<CommandPalette />)

    // Open
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    )
    expect(useCommandStore.getState().isOpen).toBe(true)

    // Wait for React to re-render so the effect re-registers with new isOpen
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .toBeVisible()

    // Close
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    )

    await expect
      .poll(() => useCommandStore.getState().isOpen, { timeout: 1000 })
      .toBe(false)
  })
})
