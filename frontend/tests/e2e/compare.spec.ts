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
 * Compare page smoke (must pass against both the MSW-mocked and the
 * real-stack Playwright configs, so it only asserts state that exists in
 * both: the route, the empty-state source picker, and the contextual nav
 * item's absence while the basket is empty).
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function establishSession(page: Page) {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Compare page', () => {
  test('renders the empty-state source picker at /compare', async ({
    page,
  }) => {
    await establishSession(page)

    await page.goto('/compare')
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('heading', { name: 'Compare', exact: true }),
    ).toBeVisible({ timeout: 10000 })
    // Empty basket → the source picker is the page body, external forms
    // included.
    await expect(page.getByText('GRIB directory on this host')).toBeVisible()
    await expect(page.getByText('External WMS server')).toBeVisible()
  })

  test('hides the contextual Compare nav item while the basket is empty', async ({
    page,
  }) => {
    await establishSession(page)

    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav.getByText('Executions')).toBeVisible({ timeout: 10000 })
    await expect(nav.getByText('Compare')).toHaveCount(0)
  })
})
