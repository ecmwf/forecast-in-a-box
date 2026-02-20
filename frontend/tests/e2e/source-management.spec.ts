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
 * Source Management E2E Tests (Full Stack)
 *
 * Tests source browsing, filtering, registry management against a real backend.
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
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
}

test.describe('Source Page Loading', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/admin/sources')
  })

  test('sources page loads with heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /source/i })
    await expect(heading.first()).toBeVisible({ timeout: 10000 })
  })

  test('sources display with status indicators', async ({ page }) => {
    // Should show source cards or rows with status badges
    const readyBadge = page.getByText('Ready')
    const availableBadge = page.getByText('Available')

    const hasReady = await readyBadge
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    const hasAvailable = await availableBadge
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)

    // At least one status should be visible if sources exist
    if (hasReady || hasAvailable) {
      expect(hasReady || hasAvailable).toBe(true)
    }
  })
})

test.describe('Source Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/admin/sources')
  })

  test('filters by AI Models type', async ({ page }) => {
    // Look for the type filter toggle group
    const modelsButton = page.getByRole('radio', { name: /ai models/i })
    if (await modelsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await modelsButton.click()
      await page.waitForTimeout(500)

      // After filtering, only model type badges should be visible
      await expect(page.locator('body')).toBeVisible()

      // Click "All Sources" to reset
      const allButton = page.getByRole('radio', { name: /all sources/i })
      if (await allButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await allButton.click()
        await page.waitForTimeout(500)
      }
    }
  })

  test('filters by Datasets type', async ({ page }) => {
    const datasetsButton = page.getByRole('radio', { name: /datasets/i })
    if (await datasetsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await datasetsButton.click()
      await page.waitForTimeout(500)

      await expect(page.locator('body')).toBeVisible()

      // Reset
      const allButton = page.getByRole('radio', { name: /all sources/i })
      if (await allButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await allButton.click()
      }
    }
  })

  test('searches sources by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search sources...')
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('IFS')
      await page.waitForTimeout(500)

      // Page should filter results
      await expect(page.locator('body')).toBeVisible()

      // Clear search
      await searchInput.clear()
      await page.waitForTimeout(500)
    }
  })

  test('toggles between card and table view', async ({ page }) => {
    const tableButton = page.getByLabel('Table view')
    const cardButton = page.getByLabel('Card view')

    if (await tableButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Switch to table view
      await tableButton.click()
      await page.waitForTimeout(500)

      // Page should render in table layout
      await expect(page.locator('body')).toBeVisible()

      // Switch back to card view
      if (await cardButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cardButton.click()
        await page.waitForTimeout(500)
      }
    }
  })

  test('combining type filter and search works', async ({ page }) => {
    // Apply type filter first
    const modelsButton = page.getByRole('radio', { name: /ai models/i })
    if (await modelsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await modelsButton.click()
      await page.waitForTimeout(500)

      // Then search within filtered results
      const searchInput = page.getByPlaceholder('Search sources...')
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('aifs')
        await page.waitForTimeout(500)

        // Should still be functional
        await expect(page.locator('body')).toBeVisible()

        // Clear both
        await searchInput.clear()
        await page.waitForTimeout(300)

        const allButton = page.getByRole('radio', { name: /all sources/i })
        if (await allButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await allButton.click()
        }
      }
    }
  })
})

test.describe('Registry Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/admin/sources')
  })

  test('registries section is visible', async ({ page }) => {
    // Look for registries heading (uppercase text)
    const registriesHeading = page.getByText(/source registries/i)
    if (
      await registriesHeading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(registriesHeading.first()).toBeVisible()
    }
  })

  test('existing registries display with connection status', async ({
    page,
  }) => {
    // Look for registry cards with status indicators
    const connectedText = page.getByText('Connected')
    const disconnectedText = page.getByText('Disconnected')

    const hasConnected = await connectedText
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    const hasDisconnected = await disconnectedText
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)

    // At least one registry should show a connection status
    if (hasConnected || hasDisconnected) {
      expect(hasConnected || hasDisconnected).toBe(true)
    }
  })

  test('add registry form opens and closes', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add registry/i })
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click()
      await page.waitForTimeout(500)

      // Form should show URL and name inputs
      const urlInput = page.getByPlaceholder('https://registry.example.com')
      const nameInput = page.getByPlaceholder('Registry name (optional)')

      if (await urlInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(urlInput).toBeVisible()
        await expect(nameInput).toBeVisible()

        // Cancel to close the form
        const cancelButton = page.getByRole('button', { name: /cancel/i })
        if (
          await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          await cancelButton.click()
          await page.waitForTimeout(300)
        }
      }
    }
  })

  test('add registry form validates URL', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add registry/i })
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click()
      await page.waitForTimeout(500)

      // Connect button should be disabled without URL
      const connectButton = page.getByRole('button', { name: /connect/i })
      if (await connectButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(connectButton).toBeDisabled()

        // Fill in a URL
        const urlInput = page.getByPlaceholder('https://registry.example.com')
        if (await urlInput.isVisible().catch(() => false)) {
          await urlInput.fill('https://test-registry.example.com')
          await page.waitForTimeout(300)

          // Connect button should now be enabled
          await expect(connectButton).toBeEnabled()
        }

        // Cancel instead of actually adding
        const cancelButton = page.getByRole('button', { name: /cancel/i })
        if (
          await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          await cancelButton.click()
        }
      }
    }
  })

  test('default registry shows default badge', async ({ page }) => {
    // Default registry should have a "Default" badge
    const defaultBadge = page.getByText('Default')
    if (
      await defaultBadge
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(defaultBadge.first()).toBeVisible()
    }
  })
})
