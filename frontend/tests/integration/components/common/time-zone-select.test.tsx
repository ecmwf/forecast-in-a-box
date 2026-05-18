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
 * TimeZoneSelect Integration Tests — search filtering, selection, keyboard nav.
 */

import { useState } from 'react'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { TimeZoneSelect } from '@/components/common/TimeZoneSelect'
import { useUiStore } from '@/stores/uiStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { listTimeZones } from '@/lib/datetime'

/** Mirrors the component: selecting a zone writes through to the store. */
function Harness() {
  const [value, setValue] = useState('UTC')
  return (
    <div>
      <TimeZoneSelect
        value={value}
        onChange={(tz) => {
          setValue(tz)
          useUiStore.getState().setTimeZone(tz)
        }}
      />
      <span data-testid="value">{value}</span>
    </div>
  )
}

describe('TimeZoneSelect', () => {
  afterEach(() => {
    useUiStore.getState().reset()
  })

  it('renders a search box and marks the current value as selected', async () => {
    const screen = await renderWithProviders(<Harness />)
    await expect.element(screen.getByLabelText('Search timezone')).toBeVisible()
    await expect
      .element(screen.getByRole('option', { selected: true }))
      .toHaveTextContent('UTC')
  })

  it('filters the list by the search query', async () => {
    const screen = await renderWithProviders(<Harness />)
    await screen.getByLabelText('Search timezone').fill('berlin')
    await expect.element(screen.getByText('Europe/Berlin')).toBeVisible()
    await expect.element(screen.getByText('Asia/Tokyo')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', async () => {
    const screen = await renderWithProviders(<Harness />)
    await screen.getByLabelText('Search timezone').fill('zzz-not-a-zone')
    await expect.element(screen.getByText('No timezone found.')).toBeVisible()
  })

  it('selecting a zone updates the store and persists it', async () => {
    const screen = await renderWithProviders(<Harness />)
    await screen.getByLabelText('Search timezone').fill('berlin')
    await screen.getByText('Europe/Berlin').click()

    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('Europe/Berlin')
    expect(useUiStore.getState().timeZone).toBe('Europe/Berlin')
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.stores.ui) ?? '{}',
    )
    expect(stored.state?.timeZone).toBe('Europe/Berlin')
  })

  it('selects the highlighted match on Enter', async () => {
    const screen = await renderWithProviders(<Harness />)
    await screen.getByLabelText('Search timezone').fill('tokyo')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('Asia/Tokyo')
  })

  it('moves the highlight with the arrow keys', async () => {
    const screen = await renderWithProviders(<Harness />)
    await screen.getByLabelText('Search timezone').fill('america/n')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    const matches = listTimeZones().filter((tz) =>
      tz.replace(/_/g, ' ').toLowerCase().includes('america/n'),
    )
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent(matches[1])
  })
})
