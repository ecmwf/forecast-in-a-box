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
 * Plugin Detail Page Integration Tests
 *
 * Tests the PluginDetailPage component:
 * - Plugin header (name, author, version, status badge)
 * - Block factory cards with source-only button behavior
 * - Tooltip on disabled non-source buttons
 * - Use All Blocks button
 * - Back to Plugins button
 */

import { describe, expect, it, vi } from 'vitest'
import { mockCatalogue } from '@tests/../mocks/data/fable.data'
import { renderWithRouter } from '@tests/utils/render'
import type { PluginInfo } from '@/api/types/plugins.types'
import { PluginDetailPage } from '@/features/plugins'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Mock plugin matching the ecmwf/ecmwf-base catalogue entry
 */
const mockPlugin: PluginInfo = {
  id: { store: 'ecmwf', local: 'ecmwf-base' },
  displayId: 'ecmwf/ecmwf-base',
  name: 'ECMWF Plugin',
  description:
    'Core ECMWF data processing plugin with source, product, and sink capabilities.',
  author: 'ECMWF',
  version: '0.0.1',
  latestVersion: '0.0.1',
  capabilities: ['source', 'product', 'sink'],
  status: 'loaded',
  isEnabled: true,
  isInstalled: true,
  hasUpdate: false,
  updatedAt: null,
  errorDetail: null,
  comment: null,
  pipSource: null,
  moduleName: null,
}

describe('Plugin Detail Page', () => {
  describe('Plugin Header', () => {
    it('renders plugin name, author, and version', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      await expect
        .element(screen.getByRole('heading', { name: 'ECMWF Plugin' }))
        .toBeVisible()
      // Author and version are combined in a single text element
      await expect.element(screen.getByText('ECMWF · v0.0.1')).toBeVisible()
    })

    it('renders plugin status badge', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      await expect.element(screen.getByText('Loaded')).toBeVisible()
    })
  })

  describe('Plugin Description', () => {
    it('renders plugin description', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      await expect
        .element(screen.getByText(/Core ECMWF data processing plugin/))
        .toBeVisible()
    })
  })

  describe('Capability Badges', () => {
    it('renders capability badges for source, product, and sink', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      // Capability badges render as Badge components (not role="button").
      // The same labels ("Source", "Product", "Sink") also appear as kind
      // badges on factory cards, so use .first() to handle multiple matches.
      await expect
        .element(screen.getByText('Source', { exact: true }).first())
        .toBeInTheDocument()
      await expect
        .element(screen.getByText('Product', { exact: true }).first())
        .toBeInTheDocument()
      await expect
        .element(screen.getByText('Sink', { exact: true }).first())
        .toBeInTheDocument()
    })
  })

  describe('Block Factory Cards', () => {
    it('renders all block factory cards', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      // ecmwf/ecmwf-base has 4 factories — use heading role to avoid
      // matching descriptions that contain similar text (vitest browser
      // mode uses case-insensitive getByText)
      await expect
        .element(screen.getByRole('heading', { name: 'Earthkit Data Source' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('heading', { name: 'Ensemble Statistics' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('heading', { name: 'Temporal Statistics' }))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('heading', { name: 'Zarr Sink' }))
        .toBeInTheDocument()
    })

    it('has enabled button for source block', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      // Wait for blocks to render
      await expect
        .element(screen.getByRole('heading', { name: 'Earthkit Data Source' }))
        .toBeInTheDocument()

      // The source block button should be enabled
      const sourceButton = screen.getByRole('button', {
        name: /Use Source in Configuration/i,
      })
      await expect.element(sourceButton).toBeInTheDocument()
      await expect.element(sourceButton).not.toBeDisabled()
    })

    it('has disabled buttons for non-source blocks', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      // Wait for blocks to render
      await expect
        .element(screen.getByRole('heading', { name: 'Ensemble Statistics' }))
        .toBeInTheDocument()

      // Product block buttons should be disabled (2 product factories)
      const productButtons = screen.getByRole('button', {
        name: /Use Product in Configuration/i,
      })
      await expect.element(productButtons.first()).toBeDisabled()
      await expect.element(productButtons.nth(1)).toBeDisabled()
    })

    it('shows tooltip on hover over disabled non-source button', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      // Wait for blocks to render
      await expect
        .element(screen.getByRole('heading', { name: 'Ensemble Statistics' }))
        .toBeInTheDocument()

      // Hover over a disabled product button's tooltip trigger
      const productButtons = screen.getByRole('button', {
        name: /Use Product in Configuration/i,
      })
      await productButtons.first().hover()

      // Tooltip text should appear
      await expect
        .element(
          screen.getByText('Configurations must start with a source block'),
        )
        .toBeVisible()
    })
  })

  describe('Use All Blocks Button', () => {
    it('renders Use All Blocks button with correct count', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      await expect
        .element(screen.getByRole('button', { name: /Use All Blocks \(4\)/i }))
        .toBeVisible()
    })
  })

  describe('Back to Plugins Button', () => {
    it('renders Back to Plugins button', async () => {
      const screen = await renderWithRouter(
        <PluginDetailPage plugin={mockPlugin} catalogue={mockCatalogue} />,
      )

      await expect
        .element(screen.getByRole('link', { name: /Back to Plugins/i }))
        .toBeVisible()
    })
  })
})
