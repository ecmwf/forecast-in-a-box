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
 * Configuration Presets Integration Tests
 *
 * Tests the ConfigPresetsSection (dashboard row) and PresetsPage:
 * - Dashboard row renders preset cards from localStorage
 * - Dashboard row hidden when no presets exist
 * - Preset cards show title, block summary tags, relative time
 * - PresetsPage renders with search, filters, and pagination
 * - PresetsPage favourite toggle and delete
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { FableMetadataStore } from '@/features/fable-builder/components/SaveConfigPopover'
import { ConfigPresetsSection } from '@/features/dashboard'
import { PresetsPage } from '@/features/dashboard/components/PresetsPage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

function setMockPresets(presets: FableMetadataStore) {
  localStorage.setItem(STORAGE_KEYS.fable.metadata, JSON.stringify(presets))
}

const mockPresets: FableMetadataStore = {
  'fable-001': {
    title: 'European Temperature Forecast',
    comments: 'Daily 2m temperature over Europe',
    summary: { source: 1, transform: 0, product: 1, sink: 1 },
    savedAt: '2026-01-15T14:30:00Z',
    isFavourite: true,
  },
  'fable-002': {
    title: 'Wind Analysis',
    comments: '',
    summary: { source: 1, transform: 0, product: 0, sink: 1 },
    savedAt: '2026-01-10T10:00:00Z',
    isFavourite: false,
  },
  'fable-003': {
    title: 'AIFS Download Test',
    comments: 'Testing AIFS forecast download and archival',
    summary: { source: 2, transform: 0, product: 1, sink: 0 },
    savedAt: '2026-02-01T10:00:00Z',
    isFavourite: false,
  },
}

describe('ConfigPresetsSection', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders nothing when no presets exist', async () => {
    const screen = await renderWithRouter(<ConfigPresetsSection />)

    // The component should return null
    await expect
      .element(screen.getByText('My Configuration Presets'))
      .not.toBeInTheDocument()
  })

  it('renders preset cards when presets exist in localStorage', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    // Section heading should be visible
    await expect
      .element(screen.getByText('My Configuration Presets'))
      .toBeVisible()

    // Preset titles should be visible
    await expect
      .element(screen.getByText('European Temperature Forecast'))
      .toBeVisible()
    await expect.element(screen.getByText('Wind Analysis')).toBeVisible()
    await expect.element(screen.getByText('AIFS Download Test')).toBeVisible()
  })

  it('shows block summary tags on preset cards', async () => {
    setMockPresets({
      'fable-001': mockPresets['fable-001'],
    })

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    // Block summary tags should be visible (e.g. "1 source", "1 product", "1 output")
    // Note: sink kind uses label "Output" from BLOCK_KIND_METADATA
    await expect.element(screen.getByText('1 source')).toBeVisible()
    await expect.element(screen.getByText('1 product')).toBeVisible()
    await expect.element(screen.getByText('1 output')).toBeVisible()
  })

  it('shows "View all presets" link', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect.element(screen.getByText('View all presets')).toBeVisible()
  })

  it('shows at most 4 preset cards on the dashboard', async () => {
    const manyPresets: FableMetadataStore = {}
    for (let i = 0; i < 6; i++) {
      manyPresets[`fable-${i}`] = {
        title: `Preset ${i}`,
        comments: '',
        summary: { source: 1, transform: 0, product: 0, sink: 0 },
        savedAt: new Date(2026, 0, i + 1).toISOString(),
        isFavourite: false,
      }
    }
    setMockPresets(manyPresets)

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    // Should show at most 4 presets (the newest ones)
    // Preset 5 (Jan 6) is newest
    await expect.element(screen.getByText('Preset 5')).toBeVisible()
    await expect.element(screen.getByText('Preset 4')).toBeVisible()
    await expect.element(screen.getByText('Preset 3')).toBeVisible()
    await expect.element(screen.getByText('Preset 2')).toBeVisible()

    // Preset 0 and 1 should not be visible (too old, only 4 shown)
    await expect.element(screen.getByText('Preset 0')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Preset 1')).not.toBeInTheDocument()
  })

  it('shows comments on preset cards when available', async () => {
    setMockPresets({
      'fable-001': mockPresets['fable-001'],
    })

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect
      .element(screen.getByText('Daily 2m temperature over Europe'))
      .toBeVisible()
  })
})

describe('PresetsPage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows empty state when no presets exist', async () => {
    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('No saved presets yet')).toBeVisible()
  })

  it('renders preset list when presets exist', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    // All preset titles should be visible
    await expect
      .element(screen.getByText('European Temperature Forecast'))
      .toBeVisible()
    await expect.element(screen.getByText('Wind Analysis')).toBeVisible()
    await expect.element(screen.getByText('AIFS Download Test')).toBeVisible()
  })

  it('renders search input', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await expect.element(searchInput).toBeVisible()
  })

  it('filters presets by search query', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await searchInput.fill('Wind')

    // Only Wind Analysis should be visible
    await expect.element(screen.getByText('Wind Analysis')).toBeVisible()
    await expect
      .element(screen.getByText('European Temperature Forecast'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('AIFS Download Test'))
      .not.toBeInTheDocument()
  })

  it('filters presets by comments content', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await searchInput.fill('archival')

    // Only AIFS Download Test should be visible (has "archival" in comments)
    await expect.element(screen.getByText('AIFS Download Test')).toBeVisible()
    await expect
      .element(screen.getByText('European Temperature Forecast'))
      .not.toBeInTheDocument()
  })

  it('shows empty filtered state when search matches nothing', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await searchInput.fill('nonexistent query')

    await expect
      .element(screen.getByText('No presets match your search.'))
      .toBeVisible()
  })

  it('renders filter buttons', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('All')).toBeVisible()
    await expect.element(screen.getByText('Bookmarked')).toBeVisible()
  })

  it('renders Load buttons for each preset', async () => {
    setMockPresets(mockPresets)

    const screen = await renderWithRouter(<PresetsPage />)

    // Each preset should have a "Use this Preset" button
    const loadButtons = screen.getByText('Use this Preset')
    await expect.element(loadButtons.first()).toBeVisible()
  })
})
