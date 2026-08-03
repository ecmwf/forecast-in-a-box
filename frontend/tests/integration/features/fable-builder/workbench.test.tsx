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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

// Partial mock — cancel navigates to /configure, absent from the test router.
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
  // Unstyled browser tests: restore dialog stacking so the backdrop can't
  // swallow clicks; top/left pin keeps it in the viewport.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="alert-dialog-content"]{position:fixed;top:0;left:0;z-index:50;background:#fff}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
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
    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({ isDirty: true })

    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )
  })

  it('fresh with a clean bench blanks the canvas without asking', async () => {
    const screen = await renderWithRouter(<FreshToggleHarness />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await screen.getByRole('button', { name: 'go fresh' }).click()

    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .not.toBeInTheDocument()
  })

  it('fresh at mount over a banked bench asks; replace blanks and clears', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(<FableBuilderPage fresh />)
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()
    // Undecided: the slot survives.
    expect(readDraft()?.fableName).toBe('Drafted work')

    await screen.getByRole('button', { name: 'New configuration' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toHaveLength(0)
    expect(readDraft()).toBeNull()
  })

  it('fresh at mount over a live dirty bench asks first', async () => {
    // As after applying template params: content + dirty in the live store.
    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({ isDirty: true })

    const screen = await renderWithRouter(<FableBuilderPage fresh />)

    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()
    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )
  })

  it('a clean saved bench still asks — one rule, no exemptions', async () => {
    // An opened blueprint, unedited: blocks live, isDirty false.
    useFableBuilderStore.getState().setFable(seedDraft().fable, 'bp-live')

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )

    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()
    // Saved bench: neutral wording instead of the loss warning.
    await expect
      .element(screen.getByRole('button', { name: 'Previous configuration' }))
      .toBeVisible()

    await screen.getByRole('button', { name: 'New configuration' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
  })

  it('mid-session fresh over unsaved work asks; replace clears the bench', async () => {
    const screen = await renderWithRouter(<FreshToggleHarness />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({ fableName: 'Working title', isDirty: true })

    await screen.getByRole('button', { name: 'go fresh' }).click()

    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()
    // Nothing lost yet — the bench is intact behind the dialog.
    expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toContain(
      'draft_block',
    )

    await screen.getByRole('button', { name: 'New configuration' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toHaveLength(0)
    expect(readDraft()).toBeNull()
  })

  it('a clean bench loads a blueprint without asking', async () => {
    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .not.toBeInTheDocument()
  })

  it('opening a blueprint over banked work asks; replace proceeds', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()

    await screen.getByRole('button', { name: 'New configuration' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(readDraft()).toBeNull()
  })

  it('picking your own work keeps the bench and abandons the load', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" />,
    )
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()

    await screen
      .getByRole('button', { name: 'Previous configuration (unsaved)' })
      .click()

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      replace: true,
    })
    expect(readDraft()?.fableName).toBe('Drafted work')
    // Init must stay gated until navigation lands (cleared-target race regression).
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)
  })

  it('a template entry over a live dirty bench asks before forking', async () => {
    useFableBuilderStore.getState().setFable(seedDraft().fable)
    useFableBuilderStore.setState({ isDirty: true })

    const screen = await renderWithRouter(
      <FableBuilderPage fableId="fable-001" templateMode />,
    )
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()

    await screen.getByRole('button', { name: 'New configuration' }).click()

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toContain('block_source_1')
    expect(useFableBuilderStore.getState().forkParentId).toBe('fable-001')
  })

  it('an encoded URL payload over banked work asks first', async () => {
    seedWorkbench()

    const screen = await renderWithRouter(
      <FableBuilderPage encodedState="some-shared-state" />,
    )
    await expect
      .element(screen.getByText('Which configuration do you want to work on?'))
      .toBeVisible()
    // Undecided — the slot must stay stored.
    expect(readDraft()?.fableName).toBe('Drafted work')
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
})
