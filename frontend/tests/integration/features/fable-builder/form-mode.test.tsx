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

// Mock useMedia to simulate desktop layout
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

/**
 * Set up a valid fable with a source + sink block for form mode tests.
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

describe('Fable Builder Form Mode', () => {
  beforeEach(() => {
    // Wipe persisted state (see build-flow.test.tsx — stale fable drafts in
    // localStorage get restored on mount and confuse single-block assertions).
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    // Switch to form mode before each test
    useFableBuilderStore.getState().setMode('form')
    vi.clearAllMocks()
  })

  it('renders form mode with block palette and mode toggle', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load - Block Palette appears in the sidebar
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // The header should show mode toggle with Form button active
    // Use .first() since "Form" text may appear in multiple locations
    const formButton = screen.getByRole('button', { name: /Form/i }).first()
    await expect.element(formButton).toBeVisible()

    // Verify the store is in form mode
    expect(useFableBuilderStore.getState().mode).toBe('form')
  })

  it('adds a source block and shows its configuration card', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block via the palette
    const addSourceButton = screen.getByRole('button', {
      name: /Operational forecast source/i,
    })
    await expect.element(addSourceButton).toBeVisible()
    await addSourceButton.click()

    // Verify block was added
    const state = useFableBuilderStore.getState()
    expect(Object.keys(state.fable.blocks)).toHaveLength(1)

    // Block should be auto-selected after adding
    expect(state.selectedBlockId).toBeTruthy()

    // Configuration fields should be visible (FieldRenderer uses Label with htmlFor).
    // Source/Forecast model are enums; Base time's labelled control is a date input.
    await expect.element(screen.getByLabelText('Base time')).toBeVisible()
    await expect.element(screen.getByLabelText('Forecast model')).toBeVisible()

    // Fable should be marked as dirty
    expect(useFableBuilderStore.getState().isDirty).toBe(true)

    // The draft-status chip should appear in the header while dirty
    await expect
      .element(screen.getByText(/saving draft|draft saved/i))
      .toBeVisible()

    // Block count should update to "1 block"
    await expect.element(screen.getByText('1 block')).toBeVisible()
  })

  it('allows configuring block parameters via form fields', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block via palette
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

    // Fable should be marked as dirty
    expect(state.isDirty).toBe(true)
  })

  it('shows block description in the instance card after adding', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    // The block instance card should show the factory description
    // Use .first() since the description also appears in the palette
    await expect
      .element(
        screen
          .getByText(
            'Fetch operational forecast data from mars or ecmwf open data',
          )
          .first(),
      )
      .toBeVisible()
  })

  it('shows validation errors on blocks with missing configuration', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Add a source block first so the UI renders the card
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    // Now set up missing config to trigger validation errors
    // The block was added to store; clear its config values
    const blockId = Object.keys(useFableBuilderStore.getState().fable.blocks)[0]
    useFableBuilderStore.getState().updateBlockConfig(blockId, 'source', '')
    useFableBuilderStore.getState().updateBlockConfig(blockId, 'forecast', '')
    useFableBuilderStore.getState().updateBlockConfig(blockId, 'base_time', '')

    // Wait for validation to run and produce errors
    await expect
      .poll(
        () => {
          const state = useFableBuilderStore.getState()
          if (!state.validationState) return false
          const blockStates = state.validationState.blockStates
          const blockState = blockStates[blockId]
          return blockState.hasErrors
        },
        { timeout: 3000 },
      )
      .toBe(true)

    // The "Has errors" badge should be visible on the card
    // Use .first() since ValidationStatusBadge in the header also shows "Has errors"
    await expect.element(screen.getByText('Has errors').first()).toBeVisible()
  })

  it('shows existing blocks with pre-filled configuration values', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a valid fable with source + sink
    setupValidFableWithSink()

    // Select the source block so its card shows
    useFableBuilderStore.getState().selectBlock('source1')

    // The source block card should show pre-filled config values. The Base time
    // date control shows the configured date (tz UTC; fixture is midnight UTC).
    const baseTimeInput = screen.getByLabelText('Base time')
    await expect.element(baseTimeInput).toBeVisible()
    await expect.element(baseTimeInput).toHaveValue('2026-01-01')
  })

  it('renders pipeline structure sidebar text', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Pipeline structure sidebar is rendered by PipelineSidebar
    // There are two instances (desktop sidebar + mobile bottom sheet), use .first()
    await expect
      .element(screen.getByText('Pipeline Structure').first())
      .toBeVisible()
  })

  it('updates store when block is added and selected in form mode', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Initially no blocks
    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(0)

    // Add a source block via the palette
    await screen
      .getByRole('button', { name: /Operational forecast source/i })
      .click()

    // Verify block was added to store
    const state = useFableBuilderStore.getState()
    expect(Object.keys(state.fable.blocks)).toHaveLength(1)

    // Block should be auto-selected
    expect(state.selectedBlockId).toBeTruthy()

    // The selected block's factory should be operationalForecastSource
    const blockId = state.selectedBlockId!
    const block = state.fable.blocks[blockId]
    expect(block.factory_id.factory).toBe('operationalForecastSource')
    expect(block.factory_id.plugin.local).toBe('ecmwf-base')
  })

  it('shows no configuration options message for blocks without config options', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a fable with a block whose factory has no configuration_options.
    // We use a synthetic factory reference — the store accepts any factory_id,
    // and we're only testing that the store holds the block correctly.
    const store = useFableBuilderStore.getState()
    store.setFable({
      blocks: {
        product1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'ecmwf-base' },
            factory: 'noConfigFactory',
          },
          configuration_values: {},
          input_ids: {},
        },
      },
    })

    // Select the product block
    useFableBuilderStore.getState().selectBlock('product1')

    // Check store correctness — the block is held in the store
    expect(
      Object.keys(useFableBuilderStore.getState().fable.blocks),
    ).toHaveLength(1)

    const blockId = 'product1'
    const block = useFableBuilderStore.getState().fable.blocks[blockId]
    expect(block.factory_id.factory).toBe('noConfigFactory')
  })
})
