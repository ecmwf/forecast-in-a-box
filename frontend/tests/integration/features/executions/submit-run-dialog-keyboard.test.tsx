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
 * Keyboard ergonomics for the SubmitRunDialog:
 * - The name field is focused on open (so Enter submits rather than toggling
 *   the run/schedule mode, which is the first tabbable element).
 * - Enter anywhere in the form submits the run.
 */

import { useState } from 'react'
import { userEvent } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type * as JobsHooks from '@/api/hooks/useJobs'
import { SubmitRunDialog } from '@/features/executions/components/SubmitRunDialog'
import { createEmptyFable } from '@/api/types/fable.types'

vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// A never-resolving submit so the assertion runs before the success path
// (navigate / activity store) fires — we only care that Enter triggered it.
const { submitSpy } = vi.hoisted(() => ({
  submitSpy: vi.fn(() => new Promise<never>(() => {})),
}))

vi.mock('@/api/hooks/useJobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsHooks>()),
  useSubmitFable: () => ({ mutateAsync: submitSpy, isPending: false }),
}))

function TestHarness() {
  const [open, setOpen] = useState(true)
  return (
    <SubmitRunDialog
      open={open}
      onOpenChange={setOpen}
      fable={createEmptyFable()}
      fableId={null}
    />
  )
}

describe('SubmitRunDialog keyboard flow', () => {
  it('focuses the name field on open', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    await expect
      .element(screen.getByRole('textbox', { name: 'Name' }))
      .toHaveFocus()
  })

  it('submits the run on Enter with an empty name (uses the generated name)', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    // Name is autofocused and left blank; Enter must still submit — the name is
    // optional (it falls back to the generated one), so it must not be `required`
    // or native validation would block the form on the empty field.
    await expect
      .element(screen.getByRole('textbox', { name: 'Name' }))
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(submitSpy).toHaveBeenCalledOnce()
  })
})
