/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Mutating tests run last: MSW artifact state persists within the file. */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { Route } from '@/routes/_authenticated/admin/artifacts.index'
import { useUiStore } from '@/stores/uiStore'

const ArtifactsPage = Route.options.component!

async function renderPage() {
  const screen = await renderWithRouter(<ArtifactsPage />)
  await expect.element(screen.getByText('AIFS Single MSE 1.1')).toBeVisible()
  return screen
}

type Screen = Awaited<ReturnType<typeof renderPage>>

const segment = (screen: Screen, name: RegExp) =>
  screen.getByRole('radio', { name })

describe('Models page', () => {
  // No app CSS: pin the dialog above its backdrop.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="alert-dialog-content"]{position:fixed;top:0;z-index:50}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    localStorage.clear()
    useUiStore.getState().setArtifactsViewMode('table')
    useUiStore.getState().setArtifactsSort({ key: 'name', dir: 'asc' })
  })

  it('lists downloaded and available models together, with counts', async () => {
    const screen = await renderPage()

    await expect
      .element(screen.getByText('AIFS Single', { exact: true }))
      .toBeVisible()
    await expect.element(segment(screen, /^All\s*4$/)).toBeChecked()
    await expect.element(segment(screen, /^Downloaded\s*2$/)).toBeVisible()
    await expect.element(segment(screen, /^Available\s*2$/)).toBeVisible()
  })

  it('narrows the list by status segment', async () => {
    const screen = await renderPage()

    await segment(screen, /^Downloaded/).click()
    await expect
      .element(screen.getByText('AIFS Single MSE 1.1'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('AIFS ENS CRPS 1.0')).toBeVisible()
  })

  it('sorts by a column header, reversing on a second click', async () => {
    const screen = await renderPage()
    const rowNames = () =>
      screen
        .getByRole('heading', { level: 4 })
        .all()
        .map((h) => h.element().textContent)

    await screen.getByRole('button', { name: /^Size/ }).click()
    await expect
      .poll(rowNames)
      .toEqual([
        'AIFS ENS',
        'AIFS Single',
        'AIFS Single MSE 1.1',
        'AIFS ENS CRPS 1.0',
      ])
    await screen.getByRole('button', { name: /^Size/ }).click()
    await expect.poll(() => rowNames()[0]).toBe('AIFS ENS CRPS 1.0')
    expect(useUiStore.getState().artifactsSort).toEqual({
      key: 'size',
      dir: 'asc',
    })
  })

  it('shows download progress in place and returns on cancel', async () => {
    const screen = await renderPage()

    await screen.getByRole('button', { name: 'Download' }).first().click()
    await expect
      .element(screen.getByRole('button', { name: 'Cancel' }))
      .toBeVisible()
    await expect.element(screen.getByText('Downloading').first()).toBeVisible()

    await screen.getByRole('button', { name: 'Cancel' }).click()
    await expect
      .poll(() => screen.getByRole('button', { name: 'Download' }).all().length)
      .toBe(2)
  })

  // Mutating test: keep last.
  it('keeps a deleted model in the Downloaded view, now available', async () => {
    const screen = await renderPage()

    await segment(screen, /^Downloaded/).click()
    await screen
      .getByRole('button', { name: 'Delete', exact: true })
      .first()
      .click()
    await screen
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect.element(segment(screen, /^Downloaded\s*1$/)).toBeVisible()
    // Still listed although it no longer matches "Downloaded".
    await expect.element(screen.getByText('AIFS ENS CRPS 1.0')).toBeVisible()
    await expect.element(screen.getByText('Available')).toBeVisible()
    await expect
      .poll(() => document.querySelectorAll('[data-held]').length)
      .toBe(1)
  })
})
