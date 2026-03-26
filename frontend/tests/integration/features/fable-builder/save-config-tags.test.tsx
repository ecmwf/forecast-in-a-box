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
 * SaveConfigPopover Tag Input Integration Tests
 *
 * Tests the tag pill input behavior in the SaveConfigPopover:
 * - Comma creates a tag pill
 * - Enter creates a tag pill
 * - Tags render as pills with X buttons
 */

import { userEvent } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { SaveConfigPopover } from '@/features/fable-builder/components/SaveConfigPopover'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { createEmptyFable } from '@/api/types/fable.types'

vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

describe('SaveConfigPopover Tag Input', () => {
  it('creates a tag pill when comma is typed', async () => {
    useFableBuilderStore.setState({ fable: createEmptyFable(), fableId: null })

    const screen = await renderWithRouter(
      <SaveConfigPopover catalogue={{}} open={true} onOpenChange={() => {}} />,
    )

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('europe,')

    await expect.element(screen.getByText('europe')).toBeVisible()
  })

  it('creates a tag pill on Enter', async () => {
    useFableBuilderStore.setState({ fable: createEmptyFable(), fableId: null })

    const screen = await renderWithRouter(
      <SaveConfigPopover catalogue={{}} open={true} onOpenChange={() => {}} />,
    )

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('production')
    await userEvent.keyboard('{Enter}')

    await expect.element(screen.getByText('production')).toBeVisible()
  })

  it('preserves spaces within tags', async () => {
    useFableBuilderStore.setState({ fable: createEmptyFable(), fableId: null })

    const screen = await renderWithRouter(
      <SaveConfigPopover catalogue={{}} open={true} onOpenChange={() => {}} />,
    )

    const input = screen.getByRole('textbox', { name: 'Tags' })
    await input.fill('my tag with spaces,')

    await expect.element(screen.getByText('my tag with spaces')).toBeVisible()
  })
})
