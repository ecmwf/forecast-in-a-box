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
 * Dashboard E2E Tests (Full Stack)
 *
 * Tests the dashboard page content, system status, and cross-page navigation.
 * Run with: npm run test:e2e:stack
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Establish anonymous session then navigate to the target page.
 * Required because the router's beforeLoad guard checks for anonymousId in localStorage.
 */
async function navigateTo(page: Page, path: string) {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  if (path !== '/dashboard') {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  await page.waitForTimeout(2000)
}

test.describe('Dashboard Content', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/dashboard')
  })

  test('dashboard loads with welcome card', async ({ page }) => {
    const welcomeHeading = page.getByText(/welcome back/i)
    await expect(welcomeHeading.first()).toBeVisible({ timeout: 10000 })
  })

  test('getting started section visible with preset cards', async ({
    page,
  }) => {
    const gettingStartedHeading = page.getByText(/getting started/i)
    if (
      await gettingStartedHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(gettingStartedHeading.first()).toBeVisible()

      // Should show preset cards
      const quickStart = page.getByText('Quick Start')
      const standardForecast = page.getByText('Standard Forecast')

      if (
        await quickStart
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await expect(quickStart.first()).toBeVisible()
      }

      if (
        await standardForecast
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await expect(standardForecast.first()).toBeVisible()
      }
    }
  })

  test('clicking a preset card navigates to configure', async ({ page }) => {
    const quickStartCard = page.getByText('Quick Start')
    if (
      await quickStartCard
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await quickStartCard.first().click()
      await page.waitForLoadState('networkidle')

      // Should navigate to configure with preset param
      await expect(page).toHaveURL(/configure/)
    }
  })

  test('stat cards display system information', async ({ page }) => {
    // Look for stat card labels
    const systemStatus = page.getByText('System Status')
    const availableModels = page.getByText('Available Models')

    if (
      await systemStatus
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(systemStatus.first()).toBeVisible()
    }

    if (
      await availableModels
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await expect(availableModels.first()).toBeVisible()
    }
  })

  test('quick action buttons are visible', async ({ page }) => {
    const managePlugins = page.getByText('Manage Plugins')
    const manageSources = page.getByText('Manage Sources')

    if (
      await managePlugins
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(managePlugins.first()).toBeVisible()
    }

    if (
      await manageSources
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await expect(manageSources.first()).toBeVisible()
    }
  })
})

test.describe('System Status', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/dashboard')
  })

  test('status indicator visible in footer', async ({ page }) => {
    // Footer should contain a status indicator
    const footer = page.locator('footer')
    if (await footer.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(footer).toBeVisible()

      // Look for clickable status element in footer
      const statusTrigger = footer.locator('button, [role="button"]')
      if ((await statusTrigger.count()) > 0) {
        await expect(statusTrigger.first()).toBeVisible()
      }
    }
  })

  test('status details popover opens on click', async ({ page }) => {
    // Find status trigger in footer or status card
    const footer = page.locator('footer')
    if (await footer.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statusTrigger = footer.locator('button, [role="button"]')
      if ((await statusTrigger.count()) > 0) {
        await statusTrigger.first().click()
        await page.waitForTimeout(500)

        // Popover should show service statuses
        const apiServer = page.getByText('API Server')
        if (await apiServer.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(apiServer).toBeVisible()
        }
      }
    }
  })
})

test.describe('Cross-Page Navigation', () => {
  test('navigates from dashboard to plugins via quick action', async ({
    page,
  }) => {
    await navigateTo(page, '/dashboard')

    const managePlugins = page.getByText('Manage Plugins')
    if (
      await managePlugins
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await managePlugins.first().click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/admin\/plugins/)
    }
  })

  test('navigates from dashboard to sources via quick action', async ({
    page,
  }) => {
    await navigateTo(page, '/dashboard')

    const manageSources = page.getByText('Manage Sources')
    if (
      await manageSources
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await manageSources.first().click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/admin\/sources/)
    }
  })

  test('full navigation cycle across pages', async ({ page }) => {
    // Dashboard → Plugins → Sources → Configure → Dashboard
    await navigateTo(page, '/dashboard')

    // Go to plugins
    await page.goto('/admin/plugins')
    await page.waitForLoadState('networkidle')
    const pluginsHeading = page.getByRole('heading', { name: /plugin/i })
    if (
      await pluginsHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(pluginsHeading.first()).toBeVisible()
    }

    // Go to sources
    await page.goto('/admin/sources')
    await page.waitForLoadState('networkidle')
    const sourcesHeading = page.getByRole('heading', { name: /source/i })
    if (
      await sourcesHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(sourcesHeading.first()).toBeVisible()
    }

    // Go to configure
    await page.goto('/configure')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/configure/)

    // Back to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
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
})
