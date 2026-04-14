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
}: {
  children: React.ReactNode
  glyphs?: Array<GlyphInfo>
}) {
  return (
    <GlyphContext.Provider value={glyphs}>{children}</GlyphContext.Provider>
  )
}

function ControlledStringField(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs>
      <GlyphFieldWrapper id="test-field" value={value} onChange={setValue}>
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
      <GlyphFieldWrapper id="test-field" value={value} onChange={setValue}>
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
      <GlyphFieldWrapper id="test-field" value={value} onChange={setValue}>
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

function ControlledEnumField(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <WithGlyphs>
      <GlyphFieldWrapper id="test-field" value={value} onChange={setValue}>
        <Select value={value || null} onValueChange={(v) => setValue(v ?? '')}>
          <SelectTrigger
            id="test-field"
            data-slot="input-group-control"
            className="flex-1 border-0 shadow-none ring-0 focus-visible:ring-0"
          >
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
      <GlyphFieldWrapper id="test-field" value={value} onChange={setValue}>
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
      const toggle = screen.getByRole('button', { name: /glyph/i })
      await expect.element(toggle).toBeVisible()
    })

    it('hides glyph toggle when no glyphs are available', async () => {
      const screen = await renderWithProviders(<NoGlyphsStringField />)
      await expect.element(screen.getByRole('textbox')).toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: /glyph/i }))
        .not.toBeInTheDocument()
    })

    it('shows toggle on date fields', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await expect
        .element(screen.getByRole('button', { name: /glyph/i }))
        .toBeVisible()
    })

    it('shows toggle on number fields', async () => {
      const screen = await renderWithProviders(<ControlledNumberField />)
      await expect
        .element(screen.getByRole('button', { name: /glyph/i }))
        .toBeVisible()
    })

    it('shows toggle on enum fields', async () => {
      const screen = await renderWithProviders(<ControlledEnumField />)
      await expect
        .element(screen.getByRole('button', { name: /glyph/i }))
        .toBeVisible()
    })
  })

  describe('Mode switching', () => {
    it('switches date field to glyph mode on toggle click', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /glyph/i }).click()

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
    it('shows "resolves to" preview for glyph values', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField initialValue="${expver}" />,
      )
      await expect.element(screen.getByText(/resolves to/i)).toBeVisible()
      await expect.element(screen.getByText('0001')).toBeVisible()
    })

    it('does not show preview when value has no glyphs', async () => {
      const screen = await renderWithProviders(
        <ControlledStringField initialValue="plain text" />,
      )
      await expect
        .element(screen.getByText(/resolves to/i))
        .not.toBeInTheDocument()
    })
  })

  describe('Auto-trigger on empty field', () => {
    it('auto-inserts ${ when toggling on an empty field', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /glyph/i }).click()

      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${')
    })
  })

  describe('Blur-exit from glyph mode', () => {
    it('returns to concrete mode when toggling on enum field', async () => {
      const screen = await renderWithProviders(
        <ControlledEnumField initialValue="opt1" />,
      )

      // Start in concrete mode — combobox visible
      await expect.element(screen.getByRole('combobox')).toBeVisible()

      // Toggle to glyph mode
      await screen.getByTestId('glyph-toggle').click()
      await expect.element(screen.getByRole('textbox')).toBeVisible()

      // Close autocomplete then toggle back
      await userEvent.keyboard('{Escape}')
      await screen.getByTestId('glyph-toggle').click()

      // Combobox should be back
      await expect.element(screen.getByRole('combobox')).toBeVisible()
    })
  })

  describe('Prevents switching back with glyph value', () => {
    it('disables toggle when value contains a glyph', async () => {
      const screen = await renderWithProviders(
        <ControlledDateField initialValue="${forecastDate}" />,
      )
      const toggle = screen.getByRole('button', { name: /glyph/i })
      await expect.element(toggle).toBeDisabled()
    })
  })

  describe('All field types support glyph entry', () => {
    it('string field', async () => {
      const screen = await renderWithProviders(<ControlledStringField />)
      await screen.getByRole('button', { name: /glyph/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${expver}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${expver}')
    })

    it('number field', async () => {
      const screen = await renderWithProviders(<ControlledNumberField />)
      await screen.getByRole('button', { name: /glyph/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${runId}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${runId}')
    })

    it('enum field', async () => {
      const screen = await renderWithProviders(<ControlledEnumField />)
      await screen.getByRole('button', { name: /glyph/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${expver}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${expver}')
    })

    it('date field', async () => {
      const screen = await renderWithProviders(<ControlledDateField />)
      await screen.getByRole('button', { name: /glyph/i }).click()
      const input = screen.getByRole('textbox')
      await input.fill('${forecastDate}')
      await expect
        .element(screen.getByTestId('current-value'))
        .toHaveTextContent('${forecastDate}')
    })
  })
})
