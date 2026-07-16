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
import { EnumField } from '@/components/base/fields/fields/EnumField'
import { BlockValidationProvider } from '@/features/fable-builder/context/BlockValidationContext'

function renderEnum({
  value,
  resolvedConfig = null,
  fieldErrors = null,
}: {
  value: string
  resolvedConfig?: Record<string, string> | null
  fieldErrors?: Record<string, Array<string>> | null
}) {
  return renderWithProviders(
    <BlockValidationProvider
      fieldErrors={fieldErrors}
      resolvedConfig={resolvedConfig}
    >
      <EnumField
        id="field-source"
        configKey="source"
        value={value}
        onChange={() => {}}
        options={['mars', 'ecmwf-open-data']}
      />
    </BlockValidationProvider>,
  )
}

describe('EnumField — resolved preview for template-injected glyph values', () => {
  it('shows "resolves to" when the value is a glyph with a backend resolution', async () => {
    const screen = await renderEnum({
      value: '${forecastSource}',
      resolvedConfig: { source: 'ecmwf-open-data' },
    })

    await expect.element(screen.getByText(/resolves to/)).toBeVisible()
    await expect
      .element(screen.getByText('ecmwf-open-data', { exact: true }))
      .toBeVisible()
  })

  it('shows nothing while the backend has not resolved the value', async () => {
    const screen = await renderEnum({ value: '${forecastSource}' })

    expect(screen.getByText(/resolves to/).elements()).toHaveLength(0)
  })

  it('shows nothing for a concrete enum value', async () => {
    const screen = await renderEnum({
      value: 'mars',
      resolvedConfig: { source: 'mars' },
    })

    expect(screen.getByText(/resolves to/).elements()).toHaveLength(0)
  })

  it('prefers the field error over the preview', async () => {
    const screen = await renderEnum({
      value: '${forecastSource}',
      resolvedConfig: { source: 'ecmwf-open-data' },
      fieldErrors: { source: ['not a valid option'] },
    })

    await expect.element(screen.getByText('not a valid option')).toBeVisible()
    expect(screen.getByText(/resolves to/).elements()).toHaveLength(0)
  })
})
