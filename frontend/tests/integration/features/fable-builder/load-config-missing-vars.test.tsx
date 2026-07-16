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
 * Loading a config that references variables unknown on this system
 * (e.g. globals from another machine) opens the missing-variables dialog
 * and stores the provided values as local variables.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderWithRouter } from '@tests/utils/render'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

// Same environment mocks as build-flow.test.tsx
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))
vi.mock('@/features/fable-builder/hooks/useURLStateSync', () => ({
  useURLStateSync: () => ({ loadedFromURL: false }),
}))
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ authType: 'anonymous', isAuthenticated: true }),
}))
vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ data: { is_superuser: true } }),
}))

const loadedConfig = {
  blocks: {
    source1: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'operationalForecastSource',
      },
      configuration_values: {
        source: '${myDataRoot}',
        forecast: 'aifs-ens',
        base_time: '2026-07-14T00:00:00',
      },
      input_ids: {},
    },
  },
  environment: null,
  local_glyphs: {},
}

describe('Load config — missing variables dialog', () => {
  // Unstyled browser tests: restore dialog stacking so the backdrop can't
  // swallow clicks; top/left pin keeps it in the viewport on this tall page.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;background:#fff}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
  })

  it('asks for unknown references and stores them as local variables', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await userEvent.upload(
      input!,
      new File([JSON.stringify(loadedConfig)], 'config.json', {
        type: 'application/json',
      }),
    )

    await expect.element(screen.getByText('Missing variables')).toBeVisible()
    // Usage context: block + option display titles from the catalogue
    await expect.element(screen.getByText(/Used in .+ → .+/)).toBeVisible()

    await screen.getByLabelText('myDataRoot').fill('/data/root')
    await screen.getByRole('button', { name: 'Apply' }).click()

    expect(useFableBuilderStore.getState().fable.local_glyphs?.myDataRoot).toBe(
      '/data/root',
    )
    expect(screen.getByText('Missing variables').elements()).toHaveLength(0)
  })

  it('Global scope creates a global variable instead of a local one', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    await userEvent.upload(
      input!,
      new File([JSON.stringify(loadedConfig)], 'config.json', {
        type: 'application/json',
      }),
    )

    await expect.element(screen.getByText('Missing variables')).toBeVisible()

    await screen.getByRole('button', { name: 'Global' }).click()
    await screen.getByLabelText('myDataRoot').fill('/srv/data')
    await screen.getByRole('button', { name: 'Apply' }).click()

    // Dialog closes on success; the value must NOT land in local_glyphs.
    await expect
      .poll(() => screen.getByText('Missing variables').elements().length)
      .toBe(0)
    expect(
      useFableBuilderStore.getState().fable.local_glyphs?.myDataRoot,
    ).toBeUndefined()
  })

  it('stays quiet when every reference resolves', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    const selfContained = {
      ...loadedConfig,
      local_glyphs: { myDataRoot: '/tmp/data' },
    }
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    await userEvent.upload(
      input!,
      new File([JSON.stringify(selfContained)], 'config.json', {
        type: 'application/json',
      }),
    )

    // Load succeeds without the missing-variables dialog.
    await expect
      .poll(() => useFableBuilderStore.getState().fable.blocks.source1)
      .toBeDefined()
    expect(screen.getByText('Missing variables').elements()).toHaveLength(0)
  })
})
