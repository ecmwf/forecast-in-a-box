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
 * Visualise page smoke (must pass against both the MSW-mocked and the
 * real-stack Playwright configs, so it only asserts state that exists in
 * both: the route, the empty-state hub, and the permanent nav item).
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function establishSession(page: Page) {
  await page.goto('/')
  await page.waitForURL(/overview/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Visualise page', () => {
  test('renders the empty-state hub at /visualise', async ({ page }) => {
    await establishSession(page)

    await page.goto('/visualise')
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('heading', { name: 'Visualise', exact: true }),
    ).toBeVisible({ timeout: 10000 })
    // Empty basket → the hub with all three source paths.
    await expect(page.getByText('Visualise forecasts on a map')).toBeVisible()
    await expect(page.getByText('GRIB directory on this host')).toBeVisible()
    await expect(
      page.getByText('External WMS server', { exact: true }),
    ).toBeVisible()
  })

  test('shows the Visualise nav item even with an empty basket', async ({
    page,
  }) => {
    await establishSession(page)

    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav.getByText('Runs')).toBeVisible({ timeout: 10000 })
    await expect(nav.getByText('Visualise')).toBeVisible()
    await nav.getByText('Visualise').click()
    await page.waitForURL(/visualise/, { timeout: 10000 })
  })
})
