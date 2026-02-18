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
import { HttpResponse, http } from 'msw'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { mockSavedFables } from '../../../../mocks/data/fable.data'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { API_ENDPOINTS } from '@/api/endpoints'

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

/**
 * Set up a fable with a source block that has configuration filled in.
 * Returns the block ID for further assertions.
 */
function setupFableWithSource(): string {
  const store = useFableBuilderStore.getState()
  store.setFable({
    blocks: {
      source1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'ekdSource',
        },
        configuration_values: {
          source: 'mars',
          date: '2026-01-01',
          expver: '0001',
        },
        input_ids: {},
      },
    },
  })
  // Mark as dirty so save button is relevant
  store.markDirty()
  return 'source1'
}

describe('Fable Builder Save & Load', () => {
  beforeEach(() => {
    useFableBuilderStore.getState().reset()
    vi.clearAllMocks()
  })

  describe('Save configuration', () => {
    it('saves a new configuration via the upsert API', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for catalogue to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Set up a fable with blocks and mark dirty
      setupFableWithSource()

      // Verify fable is dirty
      expect(useFableBuilderStore.getState().isDirty).toBe(true)

      // Click "Save Config" to open save popover
      await screen.getByRole('button', { name: /Save Config/i }).click()

      // Fill in a title
      const titleInput = screen.getByLabelText('Title')
      await titleInput.fill('My Test Configuration')

      // Click "Save" in the popover to submit
      await screen.getByRole('button', { name: 'Save', exact: true }).click()

      // Wait for save to complete (MSW handler has 500ms delay)
      await expect
        .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
        .toBe(false)

      // Store should have fableId set after save
      expect(useFableBuilderStore.getState().fableId).toBeTruthy()

      // fableName should be updated
      expect(useFableBuilderStore.getState().fableName).toBe(
        'My Test Configuration',
      )

      // lastSavedAt should be set
      expect(useFableBuilderStore.getState().lastSavedAt).toBeTruthy()

      // "Unsaved" badge should no longer be visible
      await expect.element(screen.getByText('Unsaved')).not.toBeInTheDocument()
    })

    it('updates an existing configuration when fableId is set', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for catalogue to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Set up a fable that is already saved (has fableId)
      setupFableWithSource()
      useFableBuilderStore.getState().markSaved('fable-001', 'Existing Config')

      // Make a change to trigger dirty state
      useFableBuilderStore
        .getState()
        .updateBlockConfig('source1', 'lead_time', '48')
      expect(useFableBuilderStore.getState().isDirty).toBe(true)

      // Button should say "Update Config" since this is an existing config
      await screen.getByRole('button', { name: /Update Config/i }).click()

      // Click "Update" in the popover
      await screen.getByRole('button', { name: 'Update', exact: true }).click()

      // Wait for save to complete
      await expect
        .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
        .toBe(false)

      // fableId should still be the same
      expect(useFableBuilderStore.getState().fableId).toBe('fable-001')
    })

    it('handles save error gracefully', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for catalogue to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Set up a fable with blocks
      setupFableWithSource()

      // Override upsert handler to return an error
      worker.use(
        http.post(API_ENDPOINTS.fable.upsert, () => {
          return HttpResponse.json(
            { message: 'Internal server error' },
            { status: 500 },
          )
        }),
      )

      // Click "Save Config" to open save popover
      await screen.getByRole('button', { name: /Save Config/i }).click()

      // Click "Save" in the popover
      await screen.getByRole('button', { name: 'Save', exact: true }).click()

      // Wait a moment for the error to propagate
      // isDirty should still be true (save failed)
      await expect
        .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
        .toBe(true)

      // fableId should remain null (no successful save)
      expect(useFableBuilderStore.getState().fableId).toBeNull()
    })
  })

  describe('Load configuration from backend', () => {
    it('populates the builder when setFable is called with loaded data', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for catalogue to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Simulate loading a saved fable (as if retrieved from the backend)
      const savedFable = mockSavedFables['fable-001'].fable
      useFableBuilderStore.getState().setFable(savedFable, 'fable-001')

      // The store should be populated with the loaded fable
      const state = useFableBuilderStore.getState()
      expect(state.fableId).toBe('fable-001')
      expect(Object.keys(state.fable.blocks)).toHaveLength(3)
      expect(state.isDirty).toBe(false)

      // Block count should update in the header
      await expect.element(screen.getByText('3 blocks')).toBeVisible()

      // Select the source block to see its configuration
      useFableBuilderStore.getState().selectBlock('block_source_1')

      // Config panel should show the source block's values
      await expect
        .element(
          screen.getByRole('heading', { name: 'Earthkit Data Source' }).first(),
        )
        .toBeVisible()

      // Expver field (text input) should contain the loaded value
      const expverInput = screen.getByLabelText('Expver')
      await expect.element(expverInput).toHaveValue('0001')
    })

    it('handles retrieve error by keeping builder empty', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for catalogue to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Override retrieve handler to return 404
      worker.use(
        http.get(API_ENDPOINTS.fable.retrieve, () => {
          return HttpResponse.json(
            { message: 'Fable not found' },
            { status: 404 },
          )
        }),
      )

      // The builder should remain empty (no blocks loaded)
      const state = useFableBuilderStore.getState()
      expect(Object.keys(state.fable.blocks)).toHaveLength(0)
      expect(state.fableId).toBeNull()

      // Should still show the empty hint
      await expect
        .element(screen.getByText('Click a source to get started'))
        .toBeVisible()
    })
  })

  describe('Load configuration from file', () => {
    it('loads a valid JSON config file into the builder', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for palette to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Programmatically set a loaded fable (simulating file load via setFable)
      const fileContent = mockSavedFables['fable-002'].fable
      useFableBuilderStore.getState().setFable(fileContent, null)

      // The store should be populated
      const state = useFableBuilderStore.getState()
      expect(Object.keys(state.fable.blocks)).toHaveLength(2)
      expect(state.fableId).toBeNull() // File loads have no fableId
      expect(state.isDirty).toBe(false)

      // Block count should update
      await expect.element(screen.getByText('2 blocks')).toBeVisible()
    })
  })

  describe('Save then modify flow', () => {
    it('marks fable as dirty after modifying a saved configuration', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for palette to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Load a saved fable
      const savedFable = mockSavedFables['fable-001'].fable
      useFableBuilderStore.getState().setFable(savedFable, 'fable-001')
      useFableBuilderStore
        .getState()
        .markSaved('fable-001', 'European Temperature Forecast')

      // Initially not dirty
      expect(useFableBuilderStore.getState().isDirty).toBe(false)

      // Select and modify a block
      useFableBuilderStore.getState().selectBlock('block_source_1')
      useFableBuilderStore
        .getState()
        .updateBlockConfig('block_source_1', 'expver', '0002')

      // Should now be dirty
      expect(useFableBuilderStore.getState().isDirty).toBe(true)

      // "Unsaved" badge should appear
      await expect.element(screen.getByText('Unsaved')).toBeVisible()
    })
  })

  describe('New fable reset', () => {
    it('resets the builder to empty state via newFable', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // Wait for palette to load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // Load a saved fable first
      const savedFable = mockSavedFables['fable-001'].fable
      useFableBuilderStore.getState().setFable(savedFable, 'fable-001')

      // Verify blocks are loaded
      expect(
        Object.keys(useFableBuilderStore.getState().fable.blocks),
      ).toHaveLength(3)

      // Create a new fable (reset)
      useFableBuilderStore.getState().newFable()

      // Builder should be empty
      const state = useFableBuilderStore.getState()
      expect(Object.keys(state.fable.blocks)).toHaveLength(0)
      expect(state.fableId).toBeNull()
      expect(state.isDirty).toBe(false)
      expect(state.fableName).toBe('Untitled Configuration')

      // Should show the empty hint
      await expect
        .element(screen.getByText('Click a source to get started'))
        .toBeVisible()
    })
  })

  describe('Full save and re-save flow', () => {
    it('saves, modifies, and re-saves a configuration', async () => {
      const screen = await renderWithRouter(<FableBuilderPage />)

      // 1. Wait for initial load
      await expect.element(screen.getByText('Block Palette')).toBeVisible()

      // 2. Add and configure a source block via palette
      await screen
        .getByRole('button', { name: /Earthkit Data Source/i })
        .click()
      await screen.getByLabelText('Date').fill('2026-01-15')
      await screen.getByLabelText('Expver').fill('0001')

      // 3. First save
      await screen.getByRole('button', { name: /Save Config/i }).click()
      await screen.getByRole('button', { name: 'Save', exact: true }).click()

      // Wait for save to complete
      await expect
        .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
        .toBe(false)

      const firstSaveId = useFableBuilderStore.getState().fableId
      expect(firstSaveId).toBeTruthy()

      // 4. Modify the configuration
      await screen.getByLabelText('Expver').fill('0002')
      expect(useFableBuilderStore.getState().isDirty).toBe(true)

      // 5. Re-save (should update existing)
      await screen.getByRole('button', { name: /Update Config/i }).click()
      await screen.getByRole('button', { name: 'Update', exact: true }).click()

      // Wait for re-save to complete
      await expect
        .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
        .toBe(false)

      // fableId should be preserved (same config was updated)
      expect(useFableBuilderStore.getState().fableId).toBe(firstSaveId)
    })
  })
})
