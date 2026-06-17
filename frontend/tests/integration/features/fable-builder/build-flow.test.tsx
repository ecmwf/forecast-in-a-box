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
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUiStore } from '@/stores/uiStore'

// Mock useMedia to simulate desktop layout (three-column with sidebars)
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Mock useURLStateSync to prevent navigation to /configure
// (Our test router only defines '/', so navigation would show "Not Found")
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

/**
 * Set up a valid fable with a source + sink block for review tests.
 * All config values are filled and the sink is connected to the source.
 */
function setupValidFableWithSink(): void {
  const store = useFableBuilderStore.getState()
  store.setFable({
    blocks: {
      source1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'operationalForecastSource',
        },
        configuration_values: {
          source: 'mars',
          forecast: 'aifs-ens',
          base_time: '2026-01-01T00:00:00',
        },
        input_ids: {},
      },
      sink1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'zarrSink',
        },
        configuration_values: { path: '/tmp/output.zarr' },
        input_ids: { dataset: 'source1' },
      },
    },
  })
}

/**
 * Navigate to the review step. "Review & Submit" moved into the split button's
 * caret menu when "Run Once" became the primary action.
 */
async function openReviewStep(
  screen: Awaited<ReturnType<typeof renderWithRouter>>,
): Promise<void> {
  await screen.getByRole('button', { name: /More submit options/i }).click()
  await screen.getByRole('menuitem', { name: /Review & Submit/i }).click()
}

describe('Fable Builder Integration', () => {
  beforeEach(() => {
    // Wipe persisted state from earlier tests: FableBuilderPage restores
    // `fiab.fable.draft` on mount, and a stale draft makes the store start
    // with a phantom block, causing `Object.keys(state.fable.blocks)[0]`
    // to point at the wrong one.
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    vi.clearAllMocks()
  })

  it('renders the builder and loads the block catalogue', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load - "Block Palette" appears in the sidebar header
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Verify the palette shows source blocks section
    await expect
      .element(screen.getByText('Source', { exact: true }))
      .toBeVisible()

    // With empty fable, the hint text should say "Click or drag a source to get started"
    // Note: For empty fables, validationState stays null (validation only runs when blocks exist)
    // When validationState is null, all factories are available by default
    await expect
      .element(screen.getByText('Click or drag a source to get started'))
      .toBeVisible()

    // Verify source block buttons are visible and enabled (available by default when no validationState)
    const sourceButton = screen.getByRole('button', {
      name: /Operational forecast source/i,
    })
    await expect.element(sourceButton).toBeVisible()
  })

  it('allows adding a source block from the palette', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for palette to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Find the "Operational forecast source" button in the palette
    // For empty fables, validationState is null so all factories are available by default
    const addSourceButton = screen.getByRole('button', {
      name: /Operational forecast source/i,
    })
    await expect.element(addSourceButton).toBeVisible()

    // Click to add the block
    await addSourceButton.click()

    // Verify block was added to store
    const state = useFableBuilderStore.getState()
    expect(Object.keys(state.fable.blocks)).toHaveLength(1)

    // Block should be auto-selected after adding
    expect(state.selectedBlockId).toBeTruthy()

    // Fable should be marked as dirty
    expect(state.isDirty).toBe(true)

    // The draft-status chip should appear in the header while dirty
    await expect
      .element(screen.getByText(/saving draft|draft saved/i))
      .toBeVisible()

    // Block count should update to "1 block"
    await expect.element(screen.getByText('1 block')).toBeVisible()
  })

  it('shows configuration panel when a block is selected', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for palette to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block
    const addSourceButton = screen.getByRole('button', {
      name: /Operational forecast source/i,
    })
    await addSourceButton.click()

    // The ConfigPanel should now show the block's configuration
    // Factory title appears as header in config panel (use heading role to be specific)
    await expect
      .element(
        screen
          .getByRole('heading', { name: 'Operational forecast source' })
          .first(),
      )
      .toBeVisible()

    // Configuration fields should be visible with their titles as labels.
    // Source and Forecast model are enums; Base time is a datetime input.
    await expect.element(screen.getByLabelText('Base time')).toBeVisible()
    await expect.element(screen.getByLabelText('Forecast model')).toBeVisible()
  })

  it('allows configuring a block via input fields', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for palette to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    // Fill the Base time date control (Source/Forecast model are enums — skip .fill())
    const baseTimeInput = screen.getByLabelText('Base time')
    await baseTimeInput.fill('2026-01-15')

    // Verify store state was updated. tz is UTC (set above) and the time defaults
    // to 00:00, so the canonical base_time is exactly midnight UTC.
    const state = useFableBuilderStore.getState()
    const blockId = Object.keys(state.fable.blocks)[0]
    const block = state.fable.blocks[blockId]

    expect(block.configuration_values.base_time).toBe('2026-01-15T00:00:00')
  })

  it('allows saving a fable draft', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for palette to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add and configure a source block
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    await screen.getByLabelText('Base time').fill('2026-01-15')

    // Verify fable is dirty
    expect(useFableBuilderStore.getState().isDirty).toBe(true)

    // Click "Save Config" to open save popover
    await screen.getByRole('button', { name: /Save Config/i }).click()

    // Click "Save" in the popover to submit
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Wait for save to complete (MSW handler has 500ms delay)
    // isDirty should become false after successful save
    await expect
      .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 2000 })
      .toBe(false)

    // Draft-status chip should no longer be visible after a successful save
    await expect
      .element(screen.getByText(/saving draft|draft saved/i))
      .not.toBeInTheDocument()

    // Store should have fableId set after save
    expect(useFableBuilderStore.getState().fableId).toBeTruthy()
  })

  it('allows navigating to review step', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a valid fable with source + sink (both configured and connected)
    // Review & Submit requires valid configuration AND at least one output block
    setupValidFableWithSink()

    // Wait for validation to complete and report isValid
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 3000,
      })
      .toBe(true)

    // Open the split-button menu and pick "Review & Submit"
    await openReviewStep(screen)

    // Should transition to review step
    expect(useFableBuilderStore.getState().step).toBe('review')

    // Review mode shows the sticky-header "Back to Edit" button
    await expect
      .element(screen.getByRole('button', { name: /Back to Edit/i }))
      .toBeVisible()

    // And the "Submit Job" button (the label is in a sm:inline span)
    await expect.element(screen.getByText('Submit Job')).toBeVisible()
  })

  it('allows returning from review step to edit step', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a valid fable with source + sink
    setupValidFableWithSink()

    // Wait for validation to pass
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 3000,
      })
      .toBe(true)

    // Go to review
    await openReviewStep(screen)
    expect(useFableBuilderStore.getState().step).toBe('review')

    // Click "Back to Edit" in the sticky header
    await screen.getByRole('button', { name: /Back to Edit/i }).click()

    // Should be back in edit mode
    expect(useFableBuilderStore.getState().step).toBe('edit')

    // Palette should be visible again
    await expect.element(screen.getByText('Block Palette')).toBeVisible()
  })

  it('opens the submit dialog directly via "Run Once" without entering review', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    setupValidFableWithSink()
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 3000,
      })
      .toBe(true)

    await screen.getByRole('button', { name: 'Run Once', exact: true }).click()

    // The dialog opens straight from the canvas — step stays 'edit'.
    expect(useFableBuilderStore.getState().step).toBe('edit')
    expect(useFableBuilderStore.getState().submitDialogOpen).toBe(true)
    await expect.element(screen.getByText('Submit Forecast Job')).toBeVisible()
  })

  it('opens the submit dialog on the schedule tab via "Run on Schedule"', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    setupValidFableWithSink()
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 3000,
      })
      .toBe(true)

    await screen.getByRole('button', { name: /More submit options/i }).click()
    await screen.getByRole('menuitem', { name: /Run on Schedule/i }).click()

    expect(useFableBuilderStore.getState().submitDialogMode).toBe('schedule')
    // Schedule mode swaps the primary action to "Create Schedule".
    await expect
      .element(screen.getByRole('button', { name: /Create Schedule/i }))
      .toBeVisible()
  })

  it('completes a full build flow: add block → configure → save → review', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // 1. Wait for initial load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // 2. Add a source block via palette
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    // Verify block added
    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(1)

    // 3. Configure the source block (fill text inputs, set enum via store)
    await screen.getByLabelText('Base time').fill('2026-01-15')
    const sourceBlockIdForConfig = Object.keys(
      useFableBuilderStore.getState().fable.blocks,
    )[0]
    useFableBuilderStore
      .getState()
      .updateBlockConfig(sourceBlockIdForConfig, 'source', 'mars')
    // Fill the remaining required source enum so the fable validates for the
    // review step below.
    useFableBuilderStore
      .getState()
      .updateBlockConfig(sourceBlockIdForConfig, 'forecast', 'aifs-ens')

    // 4. Add a connected sink block programmatically for review eligibility
    const sourceBlockId = Object.keys(
      useFableBuilderStore.getState().fable.blocks,
    )[0]
    const store = useFableBuilderStore.getState()
    store.addBlock(
      {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'zarrSink',
      },
      {
        kind: 'sink',
        title: 'Zarr Sink',
        description: 'Write dataset to a zarr on the local filesystem',
        configuration_options: {
          path: {
            title: 'Zarr Path',
            description: 'Filesystem path where the zarr should be written',
            value_type: 'str',
          },
        },
        inputs: ['dataset'],
      },
    )

    // Find the sink block and configure + connect it
    const sinkBlockId = Object.keys(
      useFableBuilderStore.getState().fable.blocks,
    ).find((id) => id !== sourceBlockId)!
    useFableBuilderStore
      .getState()
      .updateBlockConfig(sinkBlockId, 'path', '/tmp/output.zarr')
    useFableBuilderStore
      .getState()
      .connectBlocks(sinkBlockId, 'dataset', sourceBlockId)

    // Source + sink configuration completed above

    // 5. Save (open popover, then click Save)
    await screen.getByRole('button', { name: /Save Config/i }).click()
    await screen.getByRole('button', { name: 'Save', exact: true }).click()

    // Wait for save to complete
    await expect
      .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 2000 })
      .toBe(false)

    // 6. Wait for validation to settle. Validation is debounced + async and
    // this trails the whole build + save flow, so allow generous headroom.
    await expect
      .poll(() => useFableBuilderStore.getState().validationState?.isValid, {
        timeout: 8000,
      })
      .toBe(true)

    // 7. Go to review (via the split-button caret menu)
    await openReviewStep(screen)
    expect(useFableBuilderStore.getState().step).toBe('review')

    // Verify we're in review mode
    await expect
      .element(screen.getByRole('button', { name: /Back to Edit/i }))
      .toBeVisible()

    // The Submit Job button should be present
    await expect.element(screen.getByText('Submit Job')).toBeVisible()
    // Per-test timeout raised: the 8 s validation poll above can't fit the
    // default 5 s test budget.
  }, 15000)
})
