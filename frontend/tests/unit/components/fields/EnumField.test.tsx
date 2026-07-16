/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EnumField } from '@/components/base/fields/fields/EnumField'
import { BlockValidationProvider } from '@/features/fable-builder/context/BlockValidationContext'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

function renderEnum({
  value,
  resolvedConfig = null,
  fieldErrors = null,
  missingGlyphs = null,
}: {
  value: string
  resolvedConfig?: Record<string, string> | null
  fieldErrors?: Record<string, Array<string>> | null
  missingGlyphs?: Record<string, ReadonlyArray<string>> | null
}) {
  return renderWithProviders(
    <BlockValidationProvider
      fieldErrors={fieldErrors}
      resolvedConfig={resolvedConfig}
      missingGlyphs={missingGlyphs}
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
  // Browser-mode tests render without the app stylesheet; restore the dialog's
  // production stacking so its backdrop can't paint over the popup and swallow
  // hover events in the modal test.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;z-index:50}'
    document.head.appendChild(style)
  })

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

  it('hovering the preview opens a tooltip with the full value', async () => {
    const screen = await renderEnum({
      value: '${forecastSource}',
      resolvedConfig: { source: 'ecmwf-open-data' },
    })

    await screen.getByText(/resolves to/).hover()
    // Tooltip duplicates the value; trigger line + tooltip content = 2.
    await expect
      .element(screen.getByText('ecmwf-open-data', { exact: true }).nth(1))
      .toBeInTheDocument()
  })

  it('the preview tooltip also opens inside a modal dialog', async () => {
    const screen = await renderWithProviders(
      <Dialog open>
        <DialogContent>
          <BlockValidationProvider
            fieldErrors={null}
            resolvedConfig={{ source: 'ecmwf-open-data' }}
          >
            <EnumField
              id="field-source"
              configKey="source"
              value="${forecastSource}"
              onChange={() => {}}
              options={['mars', 'ecmwf-open-data']}
            />
          </BlockValidationProvider>
        </DialogContent>
      </Dialog>,
    )

    await screen.getByText(/resolves to/).hover()
    await expect
      .element(screen.getByText('ecmwf-open-data', { exact: true }).nth(1))
      .toBeInTheDocument()
  })

  it('offers "Define variable" for an unresolvable glyph and creates a local', async () => {
    const screen = await renderEnum({
      value: '${dataRoot}',
      fieldErrors: { source: ['Unknown glyph: ${dataRoot}'] },
      missingGlyphs: { source: ['dataRoot'] },
    })

    await screen.getByRole('button', { name: 'Define ${dataRoot}' }).click()
    await expect.element(screen.getByText('Define variable')).toBeVisible()

    await screen.getByLabelText('Value').fill('/tmp/data')
    await screen.getByRole('button', { name: 'Create' }).click()

    expect(useFableBuilderStore.getState().fable.local_glyphs?.dataRoot).toBe(
      '/tmp/data',
    )
  })

  it('define-variable with Global scope creates a global, not a local', async () => {
    const screen = await renderEnum({
      value: '${dataRoot}',
      fieldErrors: { source: ['Unknown glyph: ${dataRoot}'] },
      missingGlyphs: { source: ['dataRoot'] },
    })

    await screen.getByRole('button', { name: 'Define ${dataRoot}' }).click()
    await screen.getByRole('button', { name: 'Global' }).click()
    await screen.getByLabelText('Value').fill('/srv/data')
    await screen.getByRole('button', { name: 'Create' }).click()

    // Success (MSW-backed create) closes the dialog; the error path keeps it open.
    await expect
      .poll(() => screen.getByText('Define variable').elements().length)
      .toBe(0)
    expect(
      useFableBuilderStore.getState().fable.local_glyphs?.dataRoot,
    ).toBeUndefined()
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
