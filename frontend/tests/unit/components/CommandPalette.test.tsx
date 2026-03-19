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
 * - Search filtering
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
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
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    // The dialog should not show command content when closed
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .not.toBeInTheDocument()
  })

  it('shows command groups when opened via store', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

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
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

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
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    useCommandStore.getState().setOpen(true)

    // Getting Started commands should be visible
    await expect.element(screen.getByText('Quick Start')).toBeVisible()
    await expect.element(screen.getByText('Standard Forecast')).toBeVisible()
  })

  it('shows "No results found" for non-matching search', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    useCommandStore.getState().setOpen(true)

    // Type a search that matches nothing
    const input = screen.getByPlaceholder('Type a command or search...')
    await input.fill('zzzznonexistent')

    await expect.element(screen.getByText('No results found.')).toBeVisible()
  })

  it('closes when store isOpen is set to false', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    // Open
    useCommandStore.getState().setOpen(true)
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .toBeVisible()

    // Close
    useCommandStore.getState().setOpen(false)
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .not.toBeInTheDocument()
  })

  it('toggle cycles open and closed', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    // Toggle open
    useCommandStore.getState().toggle()
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .toBeVisible()

    // Toggle closed
    useCommandStore.getState().toggle()
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .not.toBeInTheDocument()
  })
})
