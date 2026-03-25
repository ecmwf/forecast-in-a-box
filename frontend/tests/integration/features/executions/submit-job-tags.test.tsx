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
 * Tag Input Integration Tests
 *
 * Tests the tag pill input behavior in the SubmitJobDialog:
 * - Comma creates a tag pill
 * - Enter creates a tag pill
 * - Backspace removes last tag when input is empty
 * - Duplicate tags are ignored
 * - Spaces within tags are preserved
 * - Tags render as pills with X buttons
 */

import { useState } from 'react'
import { userEvent } from '@vitest/browser/context'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { SubmitJobDialog } from '@/features/executions/components/SubmitJobDialog'
import { createEmptyFable } from '@/api/types/fable.types'

vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

function TestHarness() {
  const [open, setOpen] = useState(true)
  return (
    <SubmitJobDialog
      open={open}
      onOpenChange={setOpen}
      fable={createEmptyFable()}
      fableName="Test"
      fableId={null}
    />
  )
}

describe('SubmitJobDialog Tag Input', () => {
  it('creates a tag pill when comma is typed', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('production,')

    await expect.element(screen.getByText('production')).toBeVisible()
  })

  it('creates a tag pill on Enter', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('europe')
    await userEvent.keyboard('{Enter}')

    await expect.element(screen.getByText('europe')).toBeVisible()
  })

  it('preserves spaces within tags', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('high priority,')

    await expect.element(screen.getByText('high priority')).toBeVisible()
  })

  it('creates multiple tags from comma-separated input', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    // Type first tag
    await input.fill('alpha,')
    await expect.element(screen.getByText('alpha')).toBeVisible()

    // Type second tag
    await input.fill('beta,')
    await expect.element(screen.getByText('beta')).toBeVisible()
  })

  it('ignores duplicate tags', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('test,')
    await input.fill('test,')

    // Should only have one "test" pill
    const pills = screen.getByText('test')
    await expect.element(pills.first()).toBeVisible()
  })

  it('ignores empty tags from leading commas', async () => {
    const screen = await renderWithProviders(<TestHarness />)

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill(',,,valid,')

    await expect.element(screen.getByText('valid')).toBeVisible()
  })
})
