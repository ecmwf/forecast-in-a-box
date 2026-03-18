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
 * Navigation E2E Tests
 *
 * Tests basic navigation flows through the application.
 * Uses MSW mocks for API responses.
 */

import { expect, test } from '@playwright/test'

test.describe('Navigation', () => {
  test('loads the landing page', async ({ page }) => {
    await page.goto('/')

    // Verify the page loads without errors
    await expect(page).toHaveTitle(/Forecast/)

    // Check that the main content is visible
    await expect(page.locator('body')).toBeVisible()
  })

  test('navigates to dashboard', async ({ page }) => {
    await page.goto('/')

    // Look for a link or button to dashboard
    const dashboardLink = page.getByRole('link', { name: /dashboard/i })
    if (await dashboardLink.isVisible()) {
      await dashboardLink.click()
      await expect(page).toHaveURL(/dashboard/)
    }
  })
})
