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
 * GlobalCommandShortcuts Unit Tests
 *
 * Covers the app-wide `g`-prefixed navigation sequences: that they fire and
 * navigate, and — critically — that they stay inert while a text input is
 * focused so they never hijack typing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { renderWithRouter } from '@tests/utils/render'
import { GlobalCommandShortcuts } from '@/components/GlobalCommandShortcuts'

// Stable navigate spy (the `mock` prefix is required for vi.mock factory refs).
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('GlobalCommandShortcuts', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('navigates to the dashboard on the "g d" sequence', async () => {
    await renderWithRouter(
      <HotkeysProvider>
        <GlobalCommandShortcuts />
      </HotkeysProvider>,
    )

    await userEvent.keyboard('gd')

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' })
  })

  it('navigates to executions on the "g e" sequence', async () => {
    await renderWithRouter(
      <HotkeysProvider>
        <GlobalCommandShortcuts />
      </HotkeysProvider>,
    )

    await userEvent.keyboard('ge')

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/executions' })
  })

  it('stays inert while a text input is focused', async () => {
    const screen = await renderWithRouter(
      <HotkeysProvider>
        <input aria-label="probe" />
        <GlobalCommandShortcuts />
      </HotkeysProvider>,
    )

    // Focus the field, then type the sequence into it — it must not navigate.
    await screen.getByLabelText('probe').click()
    await userEvent.keyboard('gd')

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
