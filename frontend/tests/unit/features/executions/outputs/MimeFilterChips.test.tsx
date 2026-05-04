/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Box } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type { OutputAdapter } from '@/features/executions/outputs/types'
import { MimeFilterChips } from '@/features/executions/outputs/MimeFilterChips'
import {
  _resetRegistryForTests,
  registerOutputAdapter,
} from '@/features/executions/outputs/registry'

function makeAdapter(id: string, mime: string, label: string): OutputAdapter {
  return {
    id,
    mimeTypes: [mime],
    icon: Box,
    label: () => label,
    chipClass: 'bg-slate-100',
    extension: 'bin',
    actions: [],
  }
}

describe('MimeFilterChips', () => {
  afterEach(() => {
    _resetRegistryForTests()
  })

  it('renders an "All" chip plus one chip per available mime', async () => {
    registerOutputAdapter(makeAdapter('a', 'app/a', 'Adapter A'))
    registerOutputAdapter(makeAdapter('b', 'app/b', 'Adapter B'))
    const screen = await renderWithProviders(
      <MimeFilterChips
        availableMimes={['app/a', 'app/b']}
        activeMimes={[]}
        counts={{ 'app/a': 1, 'app/b': 1 }}
        total={2}
        onChange={() => {}}
      />,
    )
    await expect.element(screen.getByText('All')).toBeVisible()
    await expect.element(screen.getByText('Adapter A')).toBeVisible()
    await expect.element(screen.getByText('Adapter B')).toBeVisible()
  })

  it('marks "All" as pressed when activeMimes is empty', async () => {
    const screen = await renderWithProviders(
      <MimeFilterChips
        availableMimes={['app/a']}
        activeMimes={[]}
        counts={{ 'app/a': 1 }}
        total={1}
        onChange={() => {}}
      />,
    )
    const allChip = screen.getByRole('button', { name: 'All' })
    await expect.element(allChip).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles a mime onto the active set when clicked', async () => {
    registerOutputAdapter(makeAdapter('a', 'app/a', 'Adapter A'))
    const onChange = vi.fn()
    const screen = await renderWithProviders(
      <MimeFilterChips
        availableMimes={['app/a']}
        activeMimes={[]}
        counts={{ 'app/a': 1 }}
        total={1}
        onChange={onChange}
      />,
    )
    await screen.getByText('Adapter A').click()
    expect(onChange).toHaveBeenCalledWith(['app/a'])
  })

  it('clears the active set when "All" is clicked', async () => {
    registerOutputAdapter(makeAdapter('a', 'app/a', 'Adapter A'))
    const onChange = vi.fn()
    const screen = await renderWithProviders(
      <MimeFilterChips
        availableMimes={['app/a']}
        activeMimes={['app/a']}
        counts={{ 'app/a': 1 }}
        total={1}
        onChange={onChange}
      />,
    )
    await screen.getByText('All').click()
    expect(onChange).toHaveBeenCalledWith([])
  })
})
