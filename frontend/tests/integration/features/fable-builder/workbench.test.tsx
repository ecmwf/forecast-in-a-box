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
 * Workbench replace semantics: incoming configurations land immediately;
 * dirty bench work parks on the shelf and the banner restores/discards it.
 */

import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { readDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useWorkbenchShelfStore } from '@/features/fable-builder/stores/workbenchShelfStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock useMedia to simulate desktop layout (three-column with sidebars)
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Partial mock — restore navigates to /configure, absent from the test router.
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
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

function seedWorkbench(): void {
  localStorage.setItem(STORAGE_KEYS.fable.draft, JSON.stringify(seedDraft()))
}

function seedLiveDirtyBench(): void {
  useFableBuilderStore.getState().setFable(seedDraft().fable)
  useFableBuilderStore.setState({ fableName: 'Drafted work', isDirty: true })
}

function shelfName(): string | undefined {
  return useWorkbenchShelfStore.getState().shelf?.fableName
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

describe('Fable Builder workbench', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    useWorkbenchShelfStore.getState().clear()
    vi.clearAllMocks()
  })

  it('a cold boot restores the workbench silently', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('draft_block')
    expect(useFableBuilderStore.getState().isDirty).toBe(true)
    // The slot mirrors the bench — it is not consumed by the restore.
    expect(readDraft()?.fableName).toBe('Drafted work')
    expect(shelfName()).toBeUndefined()
  })

  it('the header broom issues the guarded fresh navigation', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await screen.getByRole('button', { name: 'New configuration' }).click()

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      search: { fresh: true },
    })
  })

  it('a plain visit resumes the live session', async () => {
    seedLiveDirtyBench()

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )
  })

  it('fresh with a clean bench blanks the canvas without a banner', async () => {
    const screen = await renderWithRouter(<FreshToggleHarness />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await screen.getByRole('button', { name: 'go fresh' }).click()

    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)
    expect(screen.getByTestId('workbench-shelf-banner').query()).toBeNull()
  })

  it('fresh at mount shelves the banked bench and blanks immediately', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<FableBuilderPage fresh />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toHaveLength(0)
    expect(shelfName()).toBe('Drafted work')
    // Parked work moved off the draft slot — a flush must not re-bank it.
    expect(readDraft()).toBeNull()
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()
  })

  it('mid-session fresh shelves live dirty work and blanks', async () => {
    const screen = await renderWithRouter(<FreshToggleHarness />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    seedLiveDirtyBench()
    await screen.getByRole('button', { name: 'go fresh' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toHaveLength(0)
    expect(shelfName()).toBe('Drafted work')
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()
  })

  it('a clean saved bench is replaced silently — nothing to lose', async () => {
    // An opened blueprint, unedited: blocks live, isDirty false.
    useFableBuilderStore.getState().setFable(seedDraft().fable, 'bp-live')

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(shelfName()).toBeUndefined()
    expect(screen.getByTestId('workbench-shelf-banner').query()).toBeNull()
  })

  it('opening a blueprint over banked work shelves it and proceeds', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(shelfName()).toBe('Drafted work')
    expect(readDraft()).toBeNull()
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()
  })

  it('a template entry over a live dirty bench shelves and forks', async () => {
    seedLiveDirtyBench()

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" templateMode />,
    )

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(useFableBuilderStore.getState().forkParentId).toBe('fable-001')
    expect(shelfName()).toBe('Drafted work')
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()
  })

  it('returning to the template already on the bench resumes the fork', async () => {
    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({
      forkParentId: 'fable-001',
      fableName: 'My fork',
      isDirty: true,
    })

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" templateMode />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // The fork survives — no re-fork, nothing shelved.
    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )
    expect(shelfName()).toBeUndefined()
  })

  it('template mode forks pristine', async () => {
    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" templateMode />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(useFableBuilderStore.getState().forkParentId).toBe('fable-001')
    expect(useFableBuilderStore.getState().fableId).toBeNull()
    // Untouched fork with nothing applied: still clean, replaced silently.
    expect(useFableBuilderStore.getState().isDirty).toBe(false)
  })

  it('restore over a clean bench consumes the shelf', async () => {
    seedWorkbench()
    const screen = await renderWithRouter(<FableBuilderPage fresh />)
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Restore' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('draft_block')
    expect(useFableBuilderStore.getState().fableName).toBe('Drafted work')
    expect(useFableBuilderStore.getState().isDirty).toBe(true)
    expect(shelfName()).toBeUndefined()
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      replace: true,
    })
    expect(screen.getByTestId('workbench-shelf-banner').query()).toBeNull()
  })

  it('restore over dirty work swaps it onto the shelf — lossless both ways', async () => {
    seedWorkbench()
    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )
    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')

    // Edit the loaded blueprint so the bench is worth keeping.
    useFableBuilderStore.setState({
      fableName: 'Edited blueprint',
      isDirty: true,
    })

    await screen.getByRole('button', { name: 'Restore' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('draft_block')
    // The swap: previous canvas work is now the set-aside configuration.
    expect(shelfName()).toBe('Edited blueprint')
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()
  })

  it('discard clears the shelf for good', async () => {
    seedWorkbench()
    const screen = await renderWithRouter(<FableBuilderPage fresh />)
    await expect
      .element(screen.getByTestId('workbench-shelf-banner'))
      .toBeVisible()

    await screen
      .getByRole('button', { name: 'Discard set-aside configuration' })
      .click()

    expect(shelfName()).toBeUndefined()
    expect(localStorage.getItem(STORAGE_KEYS.fable.shelf)).toBeNull()
    expect(screen.getByTestId('workbench-shelf-banner').query()).toBeNull()
  })

  it('a second shelving evicts the earlier set-aside configuration', async () => {
    useWorkbenchShelfStore
      .getState()
      .shelve(seedDraft({ fableName: 'Older set-aside' }))
    seedLiveDirtyBench()

    await renderWithRouter(<FableBuilderPage fableId="fable-001" />)

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(shelfName()).toBe('Drafted work')
  })
})
