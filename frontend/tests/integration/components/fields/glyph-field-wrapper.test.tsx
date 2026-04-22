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
 * GlyphFieldWrapper Integration Tests
 *
 * Tests the dual-mode (concrete/glyph) behavior across field types,
 * including toggle, auto-detect, auto-trigger, blur-exit, and resolved preview.
 */

import { useState } from 'react'
import { userEvent } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { GlyphFieldWrapper } from '@/components/base/fields/fields/GlyphFieldWrapper'
import { InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { ResolvedConfigContext } from '@/features/fable-builder/context/ResolvedConfigContext'
import { FieldErrorsContext } from '@/features/fable-builder/context/FieldErrorsContext'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_GLYPHS: Array<GlyphInfo> = [
  {
    name: 'expver',
    displayName: 'Experiment Version',
    valueExample: '0001',
    type: 'global',
  },
  {
    name: 'runId',
    displayName: 'Run ID',
    valueExample: 'abc-123',
    type: 'intrinsic',
  },
  {
    name: 'forecastDate',
    displayName: 'Forecast Date',
    valueExample: '2026-04-11',
    type: 'global',
  },
]

// ---------------------------------------------------------------------------
// Controlled wrappers
// ---------------------------------------------------------------------------

function WithGlyphs({
  children,
  glyphs = TEST_GLYPHS,
  resolvedConfig = null,
  fieldErrors = null,
}: {
  children: React.ReactNode
  glyphs?: Array<GlyphInfo>
  resolvedConfig?: Record<string, string> | null
  fieldErrors?: Record<string, Array<string>> | null
}) {
  return (
    <GlyphContext.Provider value={glyphs}>
      <ResolvedConfigContext.Provider value={resolvedConfig}>
        <FieldErrorsContext.Provider value={fieldErrors}>
          {children}
        </FieldErrorsContext.Provider>
      </ResolvedConfigContext.Provider>
    </GlyphContext.Provider>
  )
}

function ControlledStringField(props: {
  initialValue?: string
  resolvedConfig?: Record<string, string> | null
  fieldErrors?: Record<string, Array<string>> | null
}) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs
      resolvedConfig={props.resolvedConfig ?? null}
      fieldErrors={props.fieldErrors ?? null}
    >
      <GlyphFieldWrapper
        id="test-field"
        configKey="value"
        value={value}
        onChange={setValue}
      >
        <InputGroupInput
          id="test-field"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </GlyphFieldWrapper>
      <span data-testid="current-value">{value}</span>
    </WithGlyphs>
  )
}

function ControlledDateField(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs>
      <GlyphFieldWrapper
        id="test-field"
        configKey="value"
        value={value}
        onChange={setValue}
      >
        <InputGroupInput
          id="test-field"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </GlyphFieldWrapper>
      <span data-testid="current-value">{value}</span>
    </WithGlyphs>
  )
}

function ControlledNumberField(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs>
      <GlyphFieldWrapper
        id="test-field"
        configKey="value"
        value={value}
        onChange={setValue}
      >
        <InputGroupInput
          id="test-field"
          type="number"
          step="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </GlyphFieldWrapper>
      <span data-testid="current-value">{value}</span>
    </WithGlyphs>
  )
}

function ControlledEnumField(props: {
  initialValue?: string
  fieldErrors?: Record<string, Array<string>> | null
}) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs fieldErrors={props.fieldErrors ?? null}>
      <GlyphFieldWrapper
        id="test-field"
        configKey="value"
        value={value}
        onChange={setValue}
        allowGlyphMode={false}
      >
        <Select value={value || null} onValueChange={(v) => setValue(v ?? '')}>
          <SelectTrigger id="test-field">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opt1">opt1</SelectItem>
            <SelectItem value="opt2">opt2</SelectItem>
          </SelectContent>
        </Select>
      </GlyphFieldWrapper>
      <span data-testid="current-value">{value}</span>
    </WithGlyphs>
  )
}

function NoGlyphsStringField() {
  const [value, setValue] = useState('')
  return (
    <WithGlyphs glyphs={[]}>
      <GlyphFieldWrapper
        id="test-field"
        configKey="value"
        value={value}
        onChange={setValue}
      >
        <InputGroupInput
          id="test-field"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </GlyphFieldWrapper>
    </WithGlyphs>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlyphFieldWrapper Integration', () => {
  describe('Toggle visibility', () => {
    it('shows glyph toggle when glyphs are available', async () => {
      const screen = await renderWithProviders(<ControlledStringField />)
      const toggle = screen.getByRole('button', { name: /variable/i })
      await expect.element(toggle).toBeVisible()
    })

    it('hides glyph toggle when no glyphs are available', async () => {
      const screen = await renderWithProviders(<NoGlyphsStringField />)
      await expect.element(screen.getByRole('textbox')).toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: /variable/i }))
        .not.toBeInTheDocument()
    })

    it('shows toggle on date fields', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await expect
        .element(screen.getByRole('button', { name: /variable/i }))
        .toBeVisible()
    })

    it('shows toggle on number fields', async () => {
      const screen = await renderWithProviders(<ControlledNumberField />)
      await expect
        .element(screen.getByRole('button', { name: /variable/i }))
        .toBeVisible()
    })

    it('hides toggle on enum fields (allowGlyphMode=false)', async () => {
      const screen = await renderWithProviders(<ControlledEnumField />)
      // Enum dropdowns opt out of glyph mode — no toggle, combobox only
      await expect.element(screen.getByRole('combobox')).toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: /variable/i }))
        .not.toBeInTheDocument()
    })
  })

  describe('Mode switching', () => {
    it('switches date field to glyph mode on toggle click', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /variable/i }).click()

      // Text input should appear (glyph mode)
      const textInput = screen.getByRole('textbox')
      await expect.element(textInput).toBeVisible()
    })

    it('switches date field back to concrete mode via double toggle', async () => {
      const screen = await renderWithProviders(
        <ControlledDateField initialValue="2026-04-11" />,
      )

      // Toggle to glyph mode
      await screen.getByTestId('glyph-toggle').click()
      await expect
        .element(screen.getByRole('textbox'))
        .toHaveValue('2026-04-11')

      // Close autocomplete then toggle back
      await userEvent.keyboard('{Escape}')
      await screen.getByTestId('glyph-toggle').click()

      // Value preserved through the round-trip
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('2026-04-11')
    })
  })

  describe('Auto-detect glyph values', () => {
    it('starts in glyph mode when value contains ${...}', async () => {
      const screen = await renderWithProviders(
        <ControlledDateField initialValue="${forecastDate}" />,
      )
      // Should render as text input (glyph mode), not date picker
      const textInput = screen.getByRole('textbox')
      await expect.element(textInput).toBeVisible()
      await expect.element(textInput).toHaveValue('${forecastDate}')
    })

    it('starts in concrete mode for plain values', async () => {
      const screen = await renderWithProviders(
        <ControlledNumberField initialValue="42" />,
      )
      // Number input renders inside InputGroup — query by attribute
      const input = screen.getByRole('spinbutton')
      await expect.element(input).toBeVisible()
    })
  })

  describe('Resolved preview', () => {
    it('shows "resolves to" preview using server-resolved value', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="${expver}"
          resolvedConfig={{ value: 'server-0042' }}
        />,
      )
      await expect.element(screen.getByText(/resolves to/i)).toBeVisible()
      // Must show the backend value, not the glyph's valueExample ('0001')
      await expect.element(screen.getByText('server-0042')).toBeVisible()
    })

    it('hides preview when backend has not resolved the value yet', async () => {
      // Glyph value present, but resolvedConfig is null (in-flight / error)
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="${expver}"
          resolvedConfig={null}
        />,
      )
      await expect
        .element(screen.getByText(/resolves to/i))
        .not.toBeInTheDocument()
    })

    it('hides preview when backend map lacks this configKey', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="${expver}"
          resolvedConfig={{ other_key: 'whatever' }}
        />,
      )
      await expect
        .element(screen.getByText(/resolves to/i))
        .not.toBeInTheDocument()
    })

    it('does not show preview when value has no glyphs', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="plain text"
          resolvedConfig={{ value: 'anything' }}
        />,
      )
      await expect
        .element(screen.getByText(/resolves to/i))
        .not.toBeInTheDocument()
    })
  })

  describe('Auto-trigger on empty field', () => {
    it('auto-inserts ${ when toggling on an empty field', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /variable/i }).click()

      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${')
    })
  })

  describe('Prevents switching back with glyph value', () => {
    it('disables toggle when value contains a glyph', async () => {
      const screen = await renderWithProviders(
        <ControlledDateField initialValue="${forecastDate}" />,
      )
      const toggle = screen.getByRole('button', { name: /variable/i })
      await expect.element(toggle).toBeDisabled()
    })
  })

  describe('Text-like field types support glyph entry', () => {
    // Enum fields are excluded by design: their values are constrained by
    // the backend, so free-form glyph expressions are not meaningful.

    it('string field', async () => {
      const screen = await renderWithProviders(<ControlledStringField />)
      await screen.getByRole('button', { name: /variable/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${expver}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${expver}')
    })

    it('number field', async () => {
      const screen = await renderWithProviders(<ControlledNumberField />)
      await screen.getByRole('button', { name: /variable/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${runId}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${runId}')
    })

    it('date field', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /variable/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${forecastDate}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${forecastDate}')
    })
  })

  describe('Field-level validation errors', () => {
    it('renders inline error message for the field when FieldErrorsContext has entries', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="${runtd}"
          fieldErrors={{ value: ['Unknown glyph: ${runtd}'] }}
        />,
      )
      await expect
        .element(screen.getByText('Unknown glyph: ${runtd}'))
        .toBeVisible()
    })

    it('does not render an error when FieldErrorsContext is null', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField initialValue="${runtd}" />,
      )
      await expect
        .element(screen.getByText(/Unknown glyph/))
        .not.toBeInTheDocument()
    })

    it('collapses multiple errors into "(+N more)" suffix', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField
          initialValue="${runtd}-${ghost}"
          fieldErrors={{
            value: ['Unknown glyph: ${runtd}', 'Unknown glyph: ${ghost}'],
          }}
        />,
      )
      await expect
        .element(screen.getByText('Unknown glyph: ${runtd} (+1 more)'))
        .toBeVisible()
    })

    it('renders inline error on enum fields too (allowGlyphMode=false path)', async () => {
      const screen = await renderWithProviders(
        <ControlledEnumField
          initialValue="opt1"
          fieldErrors={{ value: ['Missing required value'] }}
        />,
      )
      await expect
        .element(screen.getByText('Missing required value'))
        .toBeVisible()
      // Combobox still rendered (no glyph toggle)
      await expect.element(screen.getByRole('combobox')).toBeVisible()
    })
  })
})
