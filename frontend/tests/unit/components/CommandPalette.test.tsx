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
 * Tests the command palette component renders without errors.
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

  it('renders without crashing when closed', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <CommandPalette />
      </HotkeysProvider>,
    )

    // The dialog content should not be visible when closed
    await expect
      .element(screen.getByPlaceholder('Type a command or search...'))
      .not.toBeInTheDocument()
  })

  it('store starts closed and can toggle', () => {
    expect(useCommandStore.getState().isOpen).toBe(false)

    useCommandStore.getState().setOpen(true)
    expect(useCommandStore.getState().isOpen).toBe(true)

    useCommandStore.getState().toggle()
    expect(useCommandStore.getState().isOpen).toBe(false)
  })
})
