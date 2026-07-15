/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type { TemplateExampleValues } from '@/api/types/plugins.types'
import type { TemplateParameters } from '@/features/fable-builder/utils/template-parameters'
import { TemplateParamsDialog } from '@/features/fable-builder/components/TemplateParamsDialog'

const params: TemplateParameters = {
  required: ['leadtime', 'region'],
  prefilled: {},
  usage: {},
}

const baseFable: FableBuilderV1 = { blocks: {}, local_glyphs: {} }

/** leadtime carries full #549 metadata; region has example_value only. */
const examples: TemplateExampleValues = {
  example_values: {},
  example_glyphs: {
    leadtime: {
      example_value: '48',
      display_name: 'Lead time',
      display_description: 'Forecast horizon in hours',
      type_hint: 'int',
    },
    region: { example_value: 'Europe' },
  },
}

function renderDialog() {
  return renderWithProviders(
    <TemplateParamsDialog
      open={true}
      params={params}
      baseFable={baseFable}
      examples={examples}
      onApply={() => {}}
      onSkip={() => {}}
    />,
  )
}

describe('TemplateParamsDialog — #549 example metadata', () => {
  it('labels a parameter with its display_name and shows the description', async () => {
    const screen = await renderDialog()

    await expect.element(screen.getByText('Lead time')).toBeVisible()
    await expect
      .element(screen.getByText('Forecast horizon in hours'))
      .toBeVisible()
  })

  it('keeps the raw glyph name reachable via the label tooltip', async () => {
    const screen = await renderDialog()

    const label = screen.getByText('Lead time')
    expect(label.element().getAttribute('title')).toBe('leadtime')
  })

  it('renders a typed field from type_hint, seeded with the example value', async () => {
    const screen = await renderDialog()

    // type_hint 'int' → numeric field instead of a plain text input
    const field = screen.getByLabelText('Lead time')
    await expect.element(field).toBeVisible()
    expect(field.element().getAttribute('value')).toBe('48')
    expect(field.element().getAttribute('inputmode')).toBe('numeric')
  })

  it('falls back to the mono glyph-name label and plain input without metadata', async () => {
    const screen = await renderDialog()

    const label = screen.getByText('region', { exact: true })
    await expect.element(label).toBeVisible()
    expect(label.element().className).toContain('font-mono')

    const field = screen.getByLabelText('region')
    expect(field.element().getAttribute('value')).toBe('Europe')
    expect(field.element().getAttribute('inputmode')).toBeNull()
  })

  it('renders enum and geodomain type hints as their picker fields', async () => {
    const screen = await renderWithProviders(
      <TemplateParamsDialog
        open={true}
        params={{ required: ['format', 'area'], prefilled: {}, usage: {} }}
        baseFable={baseFable}
        examples={{
          example_values: {},
          example_glyphs: {
            format: {
              example_value: 'png',
              display_name: 'Format',
              type_hint: 'enumClosed[png,pdf,svg]',
            },
            area: {
              example_value: 'Europe',
              display_name: 'Area',
              type_hint: 'geodomain',
            },
          },
        }}
        onApply={() => {}}
        onSkip={() => {}}
      />,
    )

    // enumClosed → select-style trigger seeded with the example value
    const format = screen.getByLabelText('Format')
    await expect.element(format).toBeVisible()
    expect(format.element().tagName).not.toBe('INPUT')
    await expect.element(screen.getByText('png', { exact: true })).toBeVisible()

    // geodomain → picker trigger showing the selected region
    const area = screen.getByLabelText('Area')
    await expect.element(area).toBeVisible()
    expect(area.element().tagName).toBe('BUTTON')
    await expect
      .element(screen.getByText('Europe', { exact: true }))
      .toBeVisible()
  })
})
