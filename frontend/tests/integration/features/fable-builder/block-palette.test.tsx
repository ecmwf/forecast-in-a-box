/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { userEvent } from 'vitest/browser'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
} from '@/api/types/fable.types'
import { BlockPalette } from '@/features/fable-builder/components/layout/BlockPalette'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUiStore } from '@/stores/uiStore'

const factory = (
  kind: BlockFactory['kind'],
  title: string,
  inputs: Array<string> = [],
): BlockFactory => ({
  kind,
  title,
  description: `${title} description`,
  configuration_options: {},
  inputs,
})

// Two plugins both ship a "Map Plot".
const catalogue: BlockFactoryCatalogue = {
  'ecmwf/ecmwf-base': {
    factories: {
      source: factory('source', 'Source A'),
      plot: factory('sink', 'Map Plot', ['dataset']),
    },
  },
  'acme/plots': { factories: { plot: factory('sink', 'Map Plot', ['data']) } },
}

type Screen = Awaited<ReturnType<typeof renderWithProviders>>

// No CSS in tests: click via the DOM.
const click = (locator: ReturnType<Screen['getByRole']>) =>
  (locator.element() as HTMLElement).click()

async function openFilterMenu(screen: Screen) {
  click(screen.getByRole('button', { name: 'Filter blocks' }))
  await expect.element(screen.getByText('Compact rows')).toBeInTheDocument()
}

describe('BlockPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    useUiStore.setState({
      paletteUsableOnly: false,
      paletteCompact: false,
    })
  })

  it('names the plugin only on blocks whose titles collide', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    await expect
      .element(screen.getByText('Map Plot · ecmwf-base'))
      .toBeVisible()
    await expect.element(screen.getByText('Map Plot · plots')).toBeVisible()
    await expect
      .element(screen.getByText('Source A', { exact: true }))
      .toBeVisible()
  })

  it('searches plugin names and filters by plugin', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    await screen.getByPlaceholder('Search blocks...').fill('acme')
    await expect.element(screen.getByText('Map Plot · plots')).toBeVisible()
    await expect
      .element(screen.getByText('Map Plot · ecmwf-base'))
      .not.toBeInTheDocument()

    await screen.getByPlaceholder('Search blocks...').fill('')
    await openFilterMenu(screen)
    click(screen.getByRole('checkbox', { name: /^ecmwf-base/ }))
    await expect
      .element(screen.getByText('Map Plot · plots'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Map Plot · ecmwf-base'))
      .toBeVisible()

    // The active filter shows as a removable chip.
    click(screen.getByRole('button', { name: 'Remove filter: ecmwf-base' }))
    await expect.element(screen.getByText('Map Plot · plots')).toBeVisible()
  })

  it('treats every plugin ticked as no plugin filter', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    await openFilterMenu(screen)
    click(screen.getByRole('checkbox', { name: /^ecmwf-base/ }))
    click(screen.getByRole('checkbox', { name: /^plots/ }))
    await expect
      .element(screen.getByRole('button', { name: /^Remove filter/ }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('Map Plot · plots')).toBeVisible()
  })

  it('hides blocks that cannot be added yet with "Only usable now"', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    // An empty canvas takes sources only.
    await openFilterMenu(screen)
    click(screen.getByRole('checkbox', { name: 'Only usable now' }))
    await expect
      .element(screen.getByText('Map Plot · plots'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Source A', { exact: true }))
      .toBeVisible()
  })

  it('drops descriptions in compact rows', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    await expect.element(screen.getByText('Source A description')).toBeVisible()
    await openFilterMenu(screen)
    click(screen.getByRole('checkbox', { name: 'Compact rows' }))
    await expect
      .element(screen.getByText('Source A description'))
      .not.toBeInTheDocument()
  })

  it('moves from the search into the list with the arrow key', async () => {
    const screen = await renderWithProviders(
      <BlockPalette catalogue={catalogue} />,
    )
    await screen.getByPlaceholder('Search blocks...').click()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toContain('Source A')
  })
})
