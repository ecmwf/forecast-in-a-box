/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { GettingStartedSection } from '@/features/dashboard/components/GettingStartedSection'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Partial router mock: card navigation targets live outside the test router.
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
}))

function seedWorkbench(): void {
  const draft: FableDraft = {
    fable: {
      blocks: {
        draft_block: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'ecmwf-base' },
            factory: 'operationalForecastSource',
          },
          configuration_values: { source: 'mars' },
          input_ids: {},
        },
      },
    },
    fableId: null,
    forkParentId: null,
    fableName: 'Drafted work',
    fableVersion: null,
    savedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEYS.fable.draft, JSON.stringify(draft))
}

describe('Dashboard continue card', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    vi.clearAllMocks()
  })

  it('an empty bench shows the scratch card, not continue', async () => {
    const screen = await renderWithRouter(<GettingStartedSection />)

    await expect
      .element(screen.getByRole('button', { name: 'Start from Scratch' }))
      .toBeVisible()
    await expect
      .element(screen.getByTestId('continue-workbench-card'))
      .not.toBeInTheDocument()
  })

  it('a banked bench shows the continue strip with its summary', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<GettingStartedSection />)

    const card = screen.getByTestId('continue-workbench-card')
    await expect.element(card).toBeVisible()
    await expect
      .element(screen.getByText(/Drafted work · 1 block · edited just now/))
      .toBeVisible()

    await card.click()
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/configure' })
  })

  it('a live store bench shows the continue card too', async () => {
    useFableBuilderStore.getState().setFable({
      blocks: {
        live_block: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'ecmwf-base' },
            factory: 'operationalForecastSource',
          },
          configuration_values: {},
          input_ids: {},
        },
      },
    })
    useFableBuilderStore.setState({ fableName: 'Live bench', isDirty: true })

    const screen = await renderWithRouter(<GettingStartedSection />)

    await expect.element(screen.getByText(/Live bench · 1 block/)).toBeVisible()
  })

  it('the scratch card stays available alongside the continue strip', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<GettingStartedSection />)
    await expect
      .element(screen.getByTestId('continue-workbench-card'))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Start from Scratch' }).click()

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      search: { fresh: true },
    })
  })
})
