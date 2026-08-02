/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { readDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock useMedia to simulate desktop layout (three-column with sidebars)
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Mock useURLStateSync to prevent navigation to /configure
vi.mock('@/features/fable-builder/hooks/useURLStateSync', () => ({
  useURLStateSync: () => ({ loadedFromURL: false }),
}))

// Mock auth hooks used by EditStep
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ authType: 'anonymous', isAuthenticated: true }),
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ data: { is_superuser: true } }),
}))

function seedDraft(overrides: Partial<FableDraft> = {}): FableDraft {
  return {
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
    ...overrides,
  }
}

/** Mirrors ConfigurePage: the route stays mounted while the search turns fresh. */
function FreshToggleHarness() {
  const [fresh, setFresh] = useState(false)
  return (
    <>
      <button onClick={() => setFresh(true)}>go fresh</button>
      <FableBuilderPage fresh={fresh} />
    </>
  )
}

describe('Fable Builder fresh intent', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    vi.clearAllMocks()
  })

  it('renders a blank canvas and keeps the stored draft', async () => {
    localStorage.setItem(
      STORAGE_KEYS.fable.drafts,
      JSON.stringify({ new: seedDraft() }),
    )

    const screen = await renderWithRouter(<FableBuilderPage fresh />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)
    // The bypassed draft must survive for a later normal visit.
    expect(readDraft('new')?.fableName).toBe('Drafted work')
  })

  it('with an encoded URL payload, the draft is neither restored nor cleared', async () => {
    localStorage.setItem(
      STORAGE_KEYS.fable.drafts,
      JSON.stringify({ new: seedDraft() }),
    )

    const screen = await renderWithRouter(
      <FableBuilderPage encodedState="some-shared-state" />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // The (mocked) URL sync owns the canvas; the draft must stay stored.
    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)
    expect(readDraft('new')?.fableName).toBe('Drafted work')
  })

  it('resumes a live session on a plain visit instead of blanking the canvas', async () => {
    // As after returning from a template session: content only in the store.
    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({ isDirty: true })

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )
  })

  it('without fresh, a matching draft is restored and consumed', async () => {
    localStorage.setItem(
      STORAGE_KEYS.fable.drafts,
      JSON.stringify({ new: seedDraft() }),
    )

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('draft_block')
    expect(useFableBuilderStore.getState().isDirty).toBe(true)
    expect(readDraft('new')).toBeNull()
  })

  it('opening a blueprint leaves an unrelated draft slot untouched', async () => {
    localStorage.setItem(
      STORAGE_KEYS.fable.drafts,
      JSON.stringify({ new: seedDraft() }),
    )

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(readDraft('new')?.fableName).toBe('Drafted work')
  })

  it('template mode resumes an in-progress fork from its own slot', async () => {
    localStorage.setItem(
      STORAGE_KEYS.fable.drafts,
      JSON.stringify({
        'template:fable-001': seedDraft({ forkParentId: 'fable-001' }),
      }),
    )

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" templateMode />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('draft_block')
    expect(useFableBuilderStore.getState().forkParentId).toBe('fable-001')
    expect(useFableBuilderStore.getState().fableId).toBeNull()
    expect(readDraft('template:fable-001')).toBeNull()
  })

  it('mid-session fresh resets the canvas after flushing work to the draft', async () => {
    const screen = await renderWithRouter(<FreshToggleHarness />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    const store = useFableBuilderStore.getState()
    store.setFable(seedDraft().fable)
    useFableBuilderStore.setState({ fableName: 'Working title', isDirty: true })

    await screen.getByRole('button', { name: 'go fresh' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toHaveLength(0)
    // Unsaved work was flushed, not destroyed.
    const draft = readDraft('new')
    expect(draft?.fable.blocks).toHaveProperty('draft_block')
    expect(draft?.fableName).toBe('Working title')
  })
})
