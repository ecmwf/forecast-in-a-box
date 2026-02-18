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
import { userEvent } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import {
  FieldRenderer,
  InlineFieldRenderer,
} from '@/components/base/fields/FieldRenderer'

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
    it('renders a number input with step=1 for int', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="int" initialValue="5" />,
      )
      const input = screen.getByRole('spinbutton')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('step', '1')
    })

    it('renders a number input with step=any for float', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="float" initialValue="3.14" />,
      )
      const input = screen.getByRole('spinbutton')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('step', 'any')
    })

    it('fires onChange on input', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="int" initialValue="0" />,
      )
      const input = screen.getByRole('spinbutton')
      await input.fill('42')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('42')
    })
  })

  describe('DateTime field', () => {
    it('renders datetime-local input for "datetime"', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="datetime" label="DateTime Field" />,
      )
      const input = screen.getByLabelText('DateTime Field')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveAttribute('type', 'datetime-local')
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
        <ControlledFieldRenderer valueType="enum['opt1','opt2','opt3']" />,
      )
      // SelectTrigger renders a button with role="combobox"
      const trigger = screen.getByRole('combobox')
      await expect.element(trigger).toBeVisible()
    })

    it('shows placeholder text', async () => {
      const screen = await renderWithProviders(
        <ControlledFieldRenderer valueType="enum['opt1','opt2','opt3']" />,
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
  })

  describe('InlineFieldRenderer', () => {
    it('renders field without label wrapper', async () => {
      const screen = await renderWithProviders(
        <InlineFieldRenderer
          id="inline-test"
          valueType="str"
          value="hello"
          onChange={() => {}}
        />,
      )
      const input = screen.getByRole('textbox')
      await expect.element(input).toBeVisible()
      await expect.element(input).toHaveValue('hello')
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
})
