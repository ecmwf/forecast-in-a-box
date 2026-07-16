/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type { FableValidationState } from '@/api/types/fable.types'
import { ValidationStatusBadge } from '@/features/fable-builder/components/shared/ValidationStatus'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const erroredState: FableValidationState = {
  isValid: false,
  globalErrors: [],
  blockStates: {
    b1: {
      errors: ['Some backend error'],
      hasErrors: true,
      possibleExpansions: [],
      possibleExpansionRestrictions: {},
      configurationRestrictions: {},
      missingGlyphs: { path: ['dataRoot'] },
    },
  },
  possibleSources: [],
  resolvedConfigurationOptions: {},
  blockOutputQubes: {},
}

function seedStore() {
  const store = useFableBuilderStore.getState()
  store.setFable(
    {
      blocks: {
        b1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'ecmwf-base' },
            factory: 'gribSink',
          },
          configuration_values: {},
          input_ids: {},
        },
      },
      local_glyphs: {},
    },
    null,
  )
  store.setValidationState(erroredState)
}

describe('ValidationStatusBadge — issues popover', () => {
  // Browser-mode tests render without the app stylesheet; restore popover
  // stacking/positioning so the popup is clickable in the viewport.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="popover-content"]{position:fixed;top:0;left:0;z-index:50;background:#fff}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    seedStore()
  })

  it('shows the issue count and lists issues in a popover', async () => {
    const screen = await renderWithProviders(<ValidationStatusBadge />)

    const badge = screen.getByRole('button', { name: /2 issues/ })
    await expect.element(badge).toBeVisible()

    await badge.click()
    await expect.element(screen.getByText('Configuration Issues')).toBeVisible()
    await expect.element(screen.getByText('Some backend error')).toBeVisible()
    await expect
      .element(screen.getByText('Unknown glyph: ${dataRoot}'))
      .toBeVisible()
  })

  it('clicking an issue selects the offending block', async () => {
    const screen = await renderWithProviders(<ValidationStatusBadge />)

    await screen.getByRole('button', { name: /2 issues/ }).click()
    await screen.getByText('Some backend error').click()

    expect(useFableBuilderStore.getState().selectedBlockId).toBe('b1')
  })

  it('renders the plain Valid badge when there are no issues', async () => {
    useFableBuilderStore.getState().setValidationState({
      ...erroredState,
      isValid: true,
      blockStates: {},
    })
    const screen = await renderWithProviders(<ValidationStatusBadge />)

    await expect.element(screen.getByText('Valid')).toBeVisible()
  })
})
