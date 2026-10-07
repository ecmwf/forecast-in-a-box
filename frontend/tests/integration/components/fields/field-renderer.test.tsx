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
 * FieldRenderer Integration Tests
 *
 * Tests the FieldRenderer component dispatching to all field types:
 * StringField, NumberField, DateTimeField, EnumField, ListField
 */

import { useState } from 'react'
import { userEvent } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { HttpResponse, http } from 'msw'
import { renderWithProviders } from '@tests/utils/render'
import { worker } from '@tests/../mocks/browser'
import { API_ENDPOINTS } from '@/api/endpoints'
import { FieldRenderer } from '@/components/base/fields/FieldRenderer'

/**
 * Controlled wrapper to capture onChange values
 */
function ControlledFieldRenderer(props: {
  valueType: string | undefined
  initialValue?: string
  label?: string
  description?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(props.initialValue ?? '')

  return (
    <div>
      <FieldRenderer
        id="test-field"
        configKey="test-field"
        valueType={props.valueType}
        value={value}
        onChange={setValue}
        label={props.label}
        description={props.description}
        disabled={props.disabled}
      />
      <span data-testid="current-value">{value}</span>
    </div>
  )
}

describe('FieldRenderer Integration', () => {
  describe('String field', () => {
    it('renders a text input for valueType="str"', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="str" />,
      )
      const input = screen.getByRole('textbox')
      await expect.element(input).toBeVisible()
    })

    it('renders a text input for undefined valueType', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType={undefined} />,
      )
      const input = screen.getByRole('textbox')
      await expect.element(input).toBeVisible()
    })

    it('fires onChange on typing', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="str" />,
      )
      const input = screen.getByRole('textbox')
      await input.fill('hello world')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('hello world')
    })

    it('renders label when provided', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="str" label="My Label" />,
      )
      await expect.element(screen.getByText('My Label')).toBeVisible()
    })

    it('renders description when provided', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="str"
          description="A helpful description"
        />,
      )
      await expect
        .element(screen.getByText('A helpful description'))
        .toBeVisible()
    })
  })

  describe('Number field', () => {
    it('renders a numeric input (inputMode=numeric) for int', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="int"
          initialValue="5"
          label="IntField"
        />,
      )
      const input = screen.getByLabelText('IntField')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('inputmode', 'numeric')
    })

    it('renders a decimal input (inputMode=decimal) for float', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="float"
          initialValue="3.14"
          label="FloatField"
        />,
      )
      const input = screen.getByLabelText('FloatField')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('inputmode', 'decimal')
    })

    it('fires onChange on input', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="int"
          initialValue="0"
          label="IntField"
        />,
      )
      const input = screen.getByLabelText('IntField')
      await input.fill('42')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('42')
    })

    it('rejects non-numeric keystrokes on int fields', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="int"
          initialValue="7"
          label="IntField"
        />,
      )
      const input = screen.getByLabelText('IntField')
      // Attempt to overwrite with a non-numeric string; controlled value snaps back.
      await input.fill('abc')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('7')
    })
  })

  describe('DateTime field', () => {
    it('renders a date + time pair for "datetime"', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="datetime" label="DateValue" />,
      )
      const dateInput = screen.getByLabelText('DateValue')
      await expect.element(dateInput).toBeVisible()
      await expect.element(dateInput).toHaveAttribute('type', 'date')
      const timeInput = screen.getByLabelText('Time', { exact: true })
      await expect.element(timeInput).toBeVisible()
      await expect.element(timeInput).toHaveAttribute('type', 'time')
    })

    it('keeps the stored value empty and shows 00:00 as the time placeholder', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="datetime" label="DateValue" />,
      )
      // Field stays blank until the user picks a date, but the time half
      // already shows 00:00 so they can see the default time that will be
      // applied once they do.
      const dateInput = screen.getByLabelText('DateValue')
      await expect.element(dateInput).toHaveValue('')
      const timeInput = screen.getByLabelText('Time', { exact: true })
      await expect.element(timeInput).toHaveValue('00:00')
    })

    it('combines date + time into an ISO 8601 string with seconds on date pick', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="datetime" label="DateValue" />,
      )
      const dateInput = screen.getByLabelText('DateValue')
      await dateInput.fill('2026-07-15')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('2026-07-15T00:00:00')
    })

    it('renders date input for "date-iso8601"', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="date-iso8601" label="Date Field" />,
      )
      const input = screen.getByLabelText('Date Field')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('type', 'date')
    })
  })

  describe('Enum field', () => {
    it('renders a select trigger for enum type', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="enum[str]('opt1','opt2','opt3')" />,
      )
      // SelectTrigger renders a button with role="combobox"
      const trigger = screen.getByRole('combobox')
      await expect.element(trigger).toBeVisible()
    })

    it('shows placeholder text', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="enum[str]('opt1','opt2','opt3')" />,
      )
      await expect
        .element(screen.getByText('Select an option...'))
        .toBeVisible()
    })
  })

  describe('List field', () => {
    it('renders badges from comma-separated value', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="list[str]"
          initialValue="alpha,beta,gamma"
        />,
      )
      // Use .first() because text also appears in the current-value span
      await expect.element(screen.getByText('alpha').first()).toBeVisible()
      await expect.element(screen.getByText('beta').first()).toBeVisible()
      await expect.element(screen.getByText('gamma').first()).toBeVisible()
    })

    it('adds item on Enter', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="list[str]" initialValue="" />,
      )
      const input = screen.getByPlaceholder('Add item...')
      await input.fill('newitem')
      await userEvent.keyboard('{Enter}')
      await expect.element(screen.getByText('newitem').first()).toBeVisible()
    })

    it('shows remove buttons for each item', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="list[str]"
          initialValue="foo,bar"
        />,
      )
      await expect
        .element(screen.getByRole('button', { name: 'Remove foo' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Remove bar' }))
        .toBeVisible()
    })

    it('removes item when remove button clicked', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="list[str]"
          initialValue="foo,bar"
        />,
      )
      await screen.getByRole('button', { name: 'Remove foo' }).click()
      await expect.element(screen.getByText('foo')).not.toBeInTheDocument()
      // "bar" appears in both the badge and the current-value span, use first()
      await expect.element(screen.getByText('bar').first()).toBeVisible()
    })

    it('does not add duplicate items', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="list[str]"
          initialValue="existing"
        />,
      )
      const input = screen.getByPlaceholder('Add item...')
      await input.fill('existing')
      await userEvent.keyboard('{Enter}')
      // Value should still be just "existing" (not "existing,existing")
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('existing')
    })

    it('hides remove buttons when disabled', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="list[str]"
          initialValue="foo,bar"
          disabled
        />,
      )
      await expect
        .element(screen.getByRole('button', { name: 'Remove foo' }))
        .not.toBeInTheDocument()
    })

    it('splits comma-separated input into separate items on Enter', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="list[str]" initialValue="" />,
      )
      const input = screen.getByPlaceholder('Add item...')
      await input.fill('2t, msl')
      await userEvent.keyboard('{Enter}')
      // Stored value must be "2t,msl" (no space) so the backend's comma split
      // yields clean tokens, not [" msl"].
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('2t,msl')
    })
  })

  describe('Unknown type fallback', () => {
    it('falls back to string input for unknown value type', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="foobar" />,
      )
      const input = screen.getByRole('textbox')
      await expect.element(input).toBeVisible()
    })
  })

  describe('GeoDomain field', () => {
    it('renders a trigger summarizing the current value', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="geodomain" initialValue="global" />,
      )
      // The trigger shows the selected name as a badge (also echoed in current-value span).
      await expect.element(screen.getByText('global').first()).toBeVisible()
    })

    it('shows the placeholder when empty', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="geodomain" />,
      )
      await expect.element(screen.getByText('Select an area…')).toBeVisible()
    })
  })

  // Labels come from the MSW resolveDisplay handler (mockParamDisplays).
  describe('Parameter fields', () => {
    const PARAM_LIST = "list[enumClosed[param]('151','165','167','999')]"

    it('labels chips with shortnames and stores ids', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType={PARAM_LIST}
          initialValue="167,151"
        />,
      )
      const chip = screen.getByText('2t', { exact: true })
      await expect.element(chip).toBeVisible()
      await expect
        .element(screen.getByText('msl', { exact: true }))
        .toBeVisible()
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('167,151')

      await chip.hover()
      await expect
        .element(
          screen.getByText('2 metre temperature [K] (2t)', { exact: true }),
        )
        .toBeVisible()
    })

    it('finds a parameter by name or id and stores its id', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType={PARAM_LIST} />,
      )
      const input = screen.getByPlaceholder('Add item...')
      await input.fill('temperature')
      await expect
        .element(screen.getByRole('option', { name: /2 metre temperature/ }))
        .toBeVisible()
      expect(screen.getByRole('option').elements()).toHaveLength(1)

      await input.fill('165')
      const wind = screen.getByRole('option', { name: /10 metre U wind/ })
      await expect.element(wind).toBeVisible()
      await wind.click()
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('165')
    })

    it('lists ids the backend cannot resolve as they are', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType={PARAM_LIST} />,
      )
      await screen.getByPlaceholder('Add item...').fill('999')
      await expect
        .element(screen.getByRole('option', { name: '999' }))
        .toBeVisible()
    })

    it('keeps a value the options no longer offer visible', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType={PARAM_LIST}
          initialValue="2t-167,151"
        />,
      )
      const stale = screen.getByText('2t-167', { exact: true })
      await expect.element(stale).toBeVisible()
      await expect
        .element(screen.getByText('msl', { exact: true }))
        .toBeVisible()

      await stale.hover()
      await expect
        .element(
          screen.getByText(
            '2t-167 is no longer offered by the input. Remove it.',
          ),
        )
        .toBeVisible()
    })

    it('labels list[param] tags', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="list[param]" initialValue="167" />,
      )
      const tag = screen.getByText('2t', { exact: true })
      await expect.element(tag).toBeVisible()
      await tag.hover()
      await expect
        .element(
          screen.getByText('2 metre temperature [K] (2t)', { exact: true }),
        )
        .toBeVisible()
    })

    it('shows the full label in a single-parameter select', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType="enumClosed[param]('167','151')"
          initialValue="167"
        />,
      )
      await expect
        .element(
          screen
            .getByRole('combobox')
            .getByText('2 metre temperature [K] (2t)'),
        )
        .toBeVisible()
    })
  })

  // Names come from the MSW artifact catalogue (list_models).
  describe('Artifact field', () => {
    const CHECKPOINTS =
      "enumClosed[artifact]('ecmwf:aifs-ens-crps-1.0_w_sdpa','ecmwf:not-in-catalogue')"

    it('shows the catalogue name instead of the wire id', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer
          valueType={CHECKPOINTS}
          initialValue="ecmwf:aifs-ens-crps-1.0_w_sdpa"
        />,
      )
      const trigger = screen.getByRole('combobox')
      await expect.element(trigger.getByText('AIFS ENS CRPS 1.0')).toBeVisible()

      await trigger.click()
      const option = screen.getByRole('option', { name: /AIFS ENS CRPS 1\.0/ })
      await expect.element(option).toBeVisible()
      // Download status replaces the size.
      await expect.element(option.getByText('Downloaded')).toBeVisible()
      expect(option.element().textContent).not.toMatch(/\d\s?[KMG]B/)
      // Unknown ids stay selectable under their wire id.
      await expect
        .element(screen.getByRole('option', { name: 'ecmwf:not-in-catalogue' }))
        .toBeVisible()
    })

    describe('with two models sharing a display name', () => {
      const model = (localId: string) => ({
        composite_id: {
          artifact_store_id: 'ecmwf',
          artifact_local_id: localId,
        },
        display_name: 'AIFS ENS CRPS 1.0',
        display_author: 'ECMWF',
        disk_size_bytes: 1,
        supported_platforms: [],
        tags: {},
        is_available: false,
        is_locally_compatible: true,
        local_compatibility_detail: null,
      })
      const useTwins = () =>
        worker.use(
          http.get(`*${API_ENDPOINTS.artifacts.listModels}`, () =>
            HttpResponse.json([model('crps_sdpa'), model('crps_flash')]),
          ),
        )

      it('keeps the bare name when only one of them is offered', async () => {
        useTwins()
        const screen = await renderWithProviders(
          <ControlledFieldRenderer
            valueType="enumClosed[artifact]('ecmwf:crps_sdpa')"
            initialValue="ecmwf:crps_sdpa"
          />,
        )
        await expect
          .element(
            screen
              .getByRole('combobox')
              .getByText('AIFS ENS CRPS 1.0', { exact: true }),
          )
          .toBeVisible()
      })

      it('tells them apart by id when both are offered', async () => {
        useTwins()
        const screen = await renderWithProviders(
          <ControlledFieldRenderer valueType="artifact" initialValue="" />,
        )
        await screen.getByRole('combobox').click()
        const flash = screen.getByRole('option', { name: /crps_flash/ })
        await expect
          .element(flash.getByText('crps_flash', { exact: true }))
          .toBeVisible()
        // The one-line trigger carries the id in its label instead.
        await flash.click()
        await expect
          .element(
            screen
              .getByRole('combobox')
              .getByText('AIFS ENS CRPS 1.0 · crps_flash'),
          )
          .toBeVisible()
      })
    })
  })
})
