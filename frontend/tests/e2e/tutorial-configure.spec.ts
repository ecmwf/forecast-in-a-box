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
 * Guided-tour launch sanity on /configure. Raw @playwright/test on purpose:
 * the shared fixtures mark the tour taken, and this spec exercises exactly
 * that surface. The full step path runs in browser-mode integration tests.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const TUTORIALS_KEY = 'fiab.store.tutorials'
const TOUR_TITLE = 'Build and run your first forecast'

test.beforeEach(async ({ page }) => {
  // Only the welcome dialog is suppressed; the tour invite stays live.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'fiab.store.onboarding',
      JSON.stringify({ state: { status: 'skipped' }, version: 2 }),
    )
  })
})

async function openConfigure(page: Page, search = '') {
  await page.goto('/')
  await page.waitForURL(/overview/, { timeout: 15000 })
  await page.goto(`/configure${search}`)
  await expect(page.getByText('Block Palette')).toBeVisible({ timeout: 10000 })
}

test.describe('Configure guided tour', () => {
  test('Help starts the tour; Skip tour records dismissed', async ({
    page,
  }) => {
    await openConfigure(page)

    await page.getByRole('button', { name: 'Help & shortcuts' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Configuration canvas' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Take the interactive tour' })
      .click()

    await expect(page.getByRole('dialog', { name: TOUR_TITLE })).toBeVisible()
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
    await expect(page.getByRole('dialog', { name: TOUR_TITLE })).toBeHidden()

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TUTORIALS_KEY,
    )
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      state: { statuses: { 'configure-first-run': 'dismissed' } },
    })
  })

  test('?tour=first-run launches the tour and strips the param', async ({
    page,
  }) => {
    await openConfigure(page, '?tour=first-run')

    await expect(page.getByRole('dialog', { name: TOUR_TITLE })).toBeVisible({
      timeout: 10000,
    })
    await page.waitForURL((url) => !url.search.includes('tour'), {
      timeout: 10000,
    })
  })
})
