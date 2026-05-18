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
 * DateTimeField Integration Tests
 *
 * The stored value is canonical naive UTC; the inputs present it in the
 * application timezone and convert back on edit. These tests verify the
 * projection, the timezone badge, edit conversion, and live re-projection.
 */

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { DateTimeField } from '@/components/base/fields/fields/DateTimeField'
import { GlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { BlockValidationProvider } from '@/features/fable-builder/context/BlockValidationContext'
import { useUiStore } from '@/stores/uiStore'

function ControlledDateTime({
  initialValue = '',
  isDateOnly = false,
}: {
  initialValue?: string
  isDateOnly?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <GlyphContext.Provider value={[]}>
      <BlockValidationProvider resolvedConfig={null} fieldErrors={null}>
        <DateTimeField
          id="base-time"
          configKey="base_time"
          value={value}
          onChange={setValue}
          isDateOnly={isDateOnly}
        />
        <span data-testid="value">{value}</span>
        <button
          type="button"
          onClick={() => useUiStore.getState().setTimeZone('Europe/Berlin')}
        >
          switch to Berlin
        </button>
      </BlockValidationProvider>
    </GlyphContext.Provider>
  )
}

describe('DateTimeField timezone projection', () => {
  afterEach(() => {
    useUiStore.getState().reset()
  })

  it('shows a canonical UTC value verbatim when the app timezone is UTC', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15T00:00:00" />,
    )
    await expect.element(screen.getByLabelText('Time')).toHaveValue('00:00')
    await expect
      .element(screen.getByTestId('datetime-tz-badge'))
      .toHaveTextContent(/^UTC$/)
  })

  it('projects a canonical UTC value into the app timezone for display', async () => {
    useUiStore.setState({ timeZone: 'Europe/Berlin' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15T00:00:00" />,
    )
    // 00:00 UTC in May is 02:00 CEST.
    await expect.element(screen.getByLabelText('Time')).toHaveValue('02:00')
    await expect
      .element(screen.getByTestId('datetime-tz-badge'))
      .toHaveTextContent(/^UTC\+2$/)
  })

  it('stores edits back as canonical UTC', async () => {
    useUiStore.setState({ timeZone: 'Europe/Berlin' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15T00:00:00" />,
    )
    // Entering 03:00 Berlin must be stored as 01:00 UTC.
    await screen.getByLabelText('Time').fill('03:00')
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('2026-05-15T01:00:00')
  })

  it('keeps edits verbatim when the app timezone is UTC', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15T00:00:00" />,
    )
    await screen.getByLabelText('Time').fill('06:30')
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('2026-05-15T06:30:00')
  })

  it('re-projects the displayed time when the app timezone changes', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15T00:00:00" />,
    )
    await expect.element(screen.getByLabelText('Time')).toHaveValue('00:00')

    await screen.getByRole('button', { name: 'switch to Berlin' }).click()

    await expect.element(screen.getByLabelText('Time')).toHaveValue('02:00')
    await expect
      .element(screen.getByTestId('datetime-tz-badge'))
      .toHaveTextContent(/^UTC\+2$/)
    // The stored canonical value is not mutated by the timezone change.
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('2026-05-15T00:00:00')
  })

  it('renders a plain date input with no timezone badge for date-only fields', async () => {
    useUiStore.setState({ timeZone: 'Europe/Berlin' })
    const screen = await renderWithProviders(
      <ControlledDateTime initialValue="2026-05-15" isDateOnly />,
    )
    await expect
      .element(screen.getByTestId('datetime-tz-badge'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('2026-05-15')
  })
})
