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
 * Guided-tour launch sanity on /visualise. Raw @playwright/test on purpose:
 * the shared fixtures mark the tour taken, and this spec exercises exactly
 * that surface. The full step path runs in browser-mode integration tests
 * (external curated WMS servers are not mocked here).
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const TUTORIALS_KEY = 'fiab.store.tutorials'

test.beforeEach(async ({ page }) => {
  // Only the welcome dialog is suppressed; the tour invite stays live.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'fiab.store.onboarding',
      JSON.stringify({ state: { status: 'skipped' }, version: 2 }),
    )
  })
})

async function openVisualise(page: Page) {
  await page.goto('/')
  await page.waitForURL(/overview/, { timeout: 15000 })
  await page.goto('/visualise')
  await expect(
    page.getByRole('heading', { name: 'Visualise', exact: true }),
  ).toBeVisible({ timeout: 10000 })
}

test.describe('Visualise guided tour', () => {
  test('hub CTA starts the tour; Skip tour records dismissed and keeps the CTA', async ({
    page,
  }) => {
    await openVisualise(page)

    const cta = page.getByRole('button', {
      name: 'Take the "Visualise forecasts on a map" tour',
    })
    await expect(cta).toBeVisible()
    await cta.click()

    await expect(
      page.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
    ).toBeHidden()
    // The entry point survives the dismissal, label unchanged.
    await expect(cta).toBeVisible()

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TUTORIALS_KEY,
    )
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      state: { statuses: { 'visualise-first-map': 'dismissed' } },
    })

    // The dismissal persists across a reload; the CTA stays offered.
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Visualise', exact: true }),
    ).toBeVisible({ timeout: 10000 })
    await expect(cta).toBeVisible()
  })

  test('?tour=first-map launches the tour and strips the param', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForURL(/overview/, { timeout: 15000 })
    await page.goto('/visualise?tour=first-map')

    await expect(
      page.getByRole('dialog', { name: 'Visualise forecasts on a map' }),
    ).toBeVisible({ timeout: 10000 })
    await page.waitForURL((url) => !url.search.includes('tour'), {
      timeout: 10000,
    })
  })
})
