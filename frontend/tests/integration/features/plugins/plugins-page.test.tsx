/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Mutating tests run last: MSW plugin state persists within the file. */

import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { worker } from '@tests/test-extend'
import { renderWithRouter } from '@tests/utils/render'
import { API_ENDPOINTS } from '@/api/endpoints'
import { setPollIntervalsForTests } from '@/api/pollIntervals'
import { Route } from '@/routes/_authenticated/admin/plugins.index'
import { useUiStore } from '@/stores/uiStore'

const PluginsPage = Route.options.component!

async function renderPage() {
  const screen = await renderWithRouter(<PluginsPage />)
  await expect
    .element(screen.getByRole('heading', { name: 'Plugin Store' }))
    .toBeVisible()
  return screen
}

type Screen = Awaited<ReturnType<typeof renderPage>>

const segment = (screen: Screen, name: RegExp) =>
  screen.getByRole('radio', { name })

const diagnosticPlugin = (loadErrors: Array<object>, installErrors = []) =>
  HttpResponse.json({
    plugins: {
      "store='ecmwf' local='diag-test'": {
        generic_data: {
          store_info: {
            pip_source: 'fiab-plugin-diag',
            module_name: 'fiab_plugin_diag',
            display_title: 'Diag Test',
            display_description: 'Plugin for diagnostics rendering',
            display_author: 'ECMWF',
            comment: '',
          },
          remote_info: null,
        },
        install_data: {
          local_version: '1.0.0',
          update_datetime: '2025-01-15T00:00:00+00:00',
          install_errors: installErrors,
        },
        settings_data: {
          isEnabled: true,
          excluded_templates: [],
          included_templates: [],
          glyph_remapping: {},
        },
        load_errors: loadErrors,
      },
    },
  })

describe('Plugins page', () => {
  beforeEach(() => {
    // Don't sit out the production 2 s catalogue-recovery poll.
    setPollIntervalsForTests({ pluginCatalogue: 50 })
    useUiStore.getState().setPluginsViewMode('table')
    useUiStore.getState().setPluginsSort({ key: 'name', dir: 'asc' })
  })

  it('lists installed and available plugins together, with status counts', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByText('Anemoi Inference')).toBeVisible()
    await expect.element(screen.getByText('Snow Analysis')).toBeVisible()
    await expect.element(segment(screen, /^All\s*11$/)).toBeChecked()
    await expect.element(segment(screen, /^Installed\s*7$/)).toBeVisible()
    await expect.element(segment(screen, /^Updates\s*1$/)).toBeVisible()
    await expect.element(segment(screen, /^Available\s*4$/)).toBeVisible()
  })

  it('narrows the list by status segment', async () => {
    const screen = await renderPage()

    await segment(screen, /^Available/).click()
    await expect.element(screen.getByText('Snow Analysis')).toBeVisible()
    await expect
      .element(screen.getByText('Anemoi Inference'))
      .not.toBeInTheDocument()

    await segment(screen, /^Updates/).click()
    await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
    await expect
      .element(screen.getByText('Snow Analysis'))
      .not.toBeInTheDocument()
  })

  it('searches by name and offers to clear filters when nothing matches', async () => {
    const screen = await renderPage()

    await screen.getByPlaceholder('Search plugins').fill('regridding')
    await expect.element(screen.getByText('ECMWF Regridding')).toBeVisible()
    await expect
      .element(screen.getByText('Anemoi Inference'))
      .not.toBeInTheDocument()

    await screen.getByPlaceholder('Search plugins').fill('no such plugin')
    await expect
      .element(screen.getByText('Nothing matches these filters'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clear filters' }).click()
    await expect.element(screen.getByText('Anemoi Inference')).toBeVisible()
  })

  it('shows an empty state when the store has no plugins', async () => {
    worker.use(
      http.get(API_ENDPOINTS.plugin.list, () =>
        HttpResponse.json({ plugins: {} }),
      ),
    )
    const screen = await renderPage()

    await expect
      .element(screen.getByText('No plugins in the store'))
      .toBeVisible()
  })

  describe('diagnostics', () => {
    it('badges a warning-only plugin amber', async () => {
      worker.use(
        http.get(API_ENDPOINTS.plugin.list, () =>
          diagnosticPlugin([
            {
              source: 'template_ingest',
              detail: "template 'x' failed validation",
              severity: 'warning',
            },
          ]),
        ),
      )
      const screen = await renderPage()

      await expect
        .element(screen.getByText('Warning', { exact: true }))
        .toBeVisible()
      await expect.element(screen.getByText('Loaded')).not.toBeInTheDocument()
    })

    it('keeps the red Errored badge when any diagnostic is an error', async () => {
      worker.use(
        http.get(API_ENDPOINTS.plugin.list, () =>
          diagnosticPlugin([
            {
              source: 'load',
              detail: "ModuleNotFoundError: no module named 'fiab_plugin_diag'",
              severity: 'error',
            },
          ]),
        ),
      )
      const screen = await renderPage()

      await expect.element(screen.getByText('Errored')).toBeVisible()
      await expect.element(screen.getByText('Loaded')).not.toBeInTheDocument()
    })

    it('lists every diagnostic with its source on the card', async () => {
      useUiStore.getState().setPluginsViewMode('card')
      worker.use(
        http.get(API_ENDPOINTS.plugin.list, () =>
          diagnosticPlugin([
            {
              source: 'template_ingest',
              detail: 'bad template',
              severity: 'warning',
            },
            { source: 'load', detail: 'version mismatch', severity: 'error' },
          ]),
        ),
      )
      const screen = await renderPage()

      await expect.element(screen.getByText('Template ingestion')).toBeVisible()
      await expect.element(screen.getByText('Plugin load')).toBeVisible()
    })
  })

  it('returns a failed install to its Install button', async () => {
    worker.use(
      http.post(API_ENDPOINTS.plugin.install, () =>
        HttpResponse.json(
          { detail: 'Plugin is already installed' },
          { status: 400 },
        ),
      ),
    )
    const screen = await renderPage()

    await segment(screen, /^Available/).click()
    await screen.getByRole('button', { name: 'Install' }).first().click()
    await expect
      .poll(() => screen.getByRole('button', { name: 'Install' }).all().length)
      .toBe(4)
  })

  // Mutating tests: keep last.
  describe('work in place', () => {
    it('keeps an installed plugin in the Available view, now loaded', async () => {
      const screen = await renderPage()

      await segment(screen, /^Available/).click()
      // Sorted by name, so Snow Analysis is last.
      const installs = screen.getByRole('button', { name: 'Install' })
      await expect.poll(() => installs.all().length).toBe(4)
      await installs.last().click()

      await expect.element(screen.getByText('Installing').first()).toBeVisible()
      await expect
        .element(screen.getByText('Loaded'), { timeout: 10_000 })
        .toBeVisible()
      // Still shown although it no longer matches "Available".
      await expect.element(screen.getByText('Snow Analysis')).toBeVisible()
      await expect.element(segment(screen, /^Available\s*3$/)).toBeVisible()
      expect(document.querySelectorAll('[data-held]')).toHaveLength(1)
    })

    it('updates a plugin in place', async () => {
      const screen = await renderPage()

      await segment(screen, /^Updates/).click()
      await screen.getByRole('button', { name: 'Update', exact: true }).click()

      await expect
        .element(segment(screen, /^Updates\s*0$/), { timeout: 10_000 })
        .toBeVisible()
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
    })
  })
})
