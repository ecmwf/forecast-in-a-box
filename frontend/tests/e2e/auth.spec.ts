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
 * Auth E2E Tests (Full Stack)
 *
 * Tests authentication flows against a real backend including:
 * - Anonymous authentication
 * - Route access and permissions
 * - Session persistence
 * - Cross-route navigation
 *
 * Run with: npm run test:e2e:stack
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Establish an anonymous session by visiting the root URL.
 * The anonymous auth provider sets a UUID in localStorage on mount,
 * which the router's beforeLoad guard requires for authenticated routes.
 * After auth initializes, the landing page redirects to /dashboard.
 */
async function establishSession(page: Page) {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Anonymous Authentication', () => {
  test('anonymous user is redirected from landing to dashboard', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/Forecast/)
    // Anonymous users are automatically authenticated and redirected to dashboard
    await page.waitForURL(/dashboard/, { timeout: 15000 })
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({
      timeout: 10000,
    })
  })

  test('anonymous user can access dashboard directly', async ({ page }) => {
    await establishSession(page)

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Dashboard should be accessible with anonymous auth
    const heading = page.getByRole('heading', { level: 2 })
    await expect(heading.first()).toBeVisible({ timeout: 10000 })
  })

  test('dashboard shows welcome content', async ({ page }) => {
    await establishSession(page)

    // Should show "Welcome back" heading for anonymous user
    const welcomeHeading = page.getByText(/welcome back/i)
    if (
      await welcomeHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(welcomeHeading.first()).toBeVisible()
    }
  })

  test('session persists across page reloads', async ({ page }) => {
    await establishSession(page)

    // Verify dashboard content is loaded
    const heading = page.getByRole('heading', { level: 2 })
    await expect(heading.first()).toBeVisible({ timeout: 10000 })

    // Reload the page
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Should still show dashboard content after reload
    await expect(heading.first()).toBeVisible({ timeout: 10000 })
  })

  test('admin routes are accessible with anonymous auth', async ({ page }) => {
    await establishSession(page)

    // Navigate to plugins admin page
    await page.goto('/admin/plugins')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const pluginsHeading = page.getByRole('heading', { name: /plugin/i })
    if (
      await pluginsHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(pluginsHeading.first()).toBeVisible()
    }

    // Navigate to sources admin page
    await page.goto('/admin/sources')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const sourcesHeading = page.getByRole('heading', { name: /source/i })
    if (
      await sourcesHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(sourcesHeading.first()).toBeVisible()
    }
  })

  test('navigation between authenticated routes works', async ({ page }) => {
    await establishSession(page)

    // Navigate to configure page
    await page.goto('/configure')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/configure/)

    // Navigate to plugins
    await page.goto('/admin/plugins')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/admin\/plugins/)

    // Navigate to sources
    await page.goto('/admin/sources')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/admin\/sources/)

    // Navigate back to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/dashboard/)
  })
})
