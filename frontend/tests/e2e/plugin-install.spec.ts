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
 * Plugin Install E2E Tests (Full Stack)
 *
 * Verifies the full plugin install flow including the catalogue 503 retry.
 * After installing a plugin the backend temporarily returns 503 on the
 * catalogue endpoint while plugins reload. The UI must wait for the
 * catalogue to recover, then refresh plugin details so the installed
 * plugin moves from "Available" to "Installed".
 *
 * Works with both MSW mocks (npm run test:e2e) and a real backend
 * (npm run test:e2e:stack).
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Establish anonymous session then navigate to the target page.
 * Required because the router's beforeLoad guard checks for anonymousId
 * in localStorage.
 */
async function navigateTo(page: Page, path: string) {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
}

test.describe('Plugin Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/admin/plugins')
  })

  test('installing a plugin moves it from available to installed', async ({
    page,
  }) => {
    // Track catalogue 503 responses to verify retry behaviour
    let catalogue503Count = 0
    let catalogue200Count = 0
    page.on('response', (response) => {
      if (response.url().includes('/fable/catalogue')) {
        if (response.status() === 503) catalogue503Count++
        if (response.status() === 200) catalogue200Count++
      }
    })

    // Wait for the page to fully load
    const heading = page.getByRole('heading', { name: /plugin store/i })
    await expect(heading).toBeVisible({ timeout: 10000 })

    // Switch to card view so each plugin has its own Card element
    // (table view wraps all rows in a single Card, making scoping unreliable)
    const cardViewBtn = page.getByLabel('Card view')
    if (await cardViewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cardViewBtn.click()
      await page.waitForTimeout(500)
    }

    // Find the first available plugin card that has an Install button.
    // The available section always uses card view (individual Card per plugin).
    const availableCards = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('button', { name: /^Install$/ }) })
    const cardCount = await availableCards.count()

    // Skip if no available plugins (real backend may have none)
    if (cardCount === 0) {
      test.skip(true, 'No available plugins to install')
      return
    }

    const card = availableCards.first()
    await expect(card).toBeVisible({ timeout: 5000 })

    // Read the plugin name from the card heading (h3 in PluginCard)
    const pluginNameEl = card.locator('h3').first()
    const pluginName = (await pluginNameEl.textContent()) ?? ''
    expect(pluginName.length).toBeGreaterThan(0)

    // Verify the card has no toggle switch yet (not installed)
    await expect(card.getByRole('switch')).not.toBeVisible()

    // Reset catalogue counters right before clicking install
    catalogue503Count = 0
    catalogue200Count = 0

    // Click the Install button
    await card.getByRole('button', { name: /^Install$/ }).click()

    // The mutation triggers:
    //  1. POST /plugin/install  → 200
    //  2. GET  /fable/catalogue → 503  (plugins reloading)
    //  3. GET  /fable/catalogue → 200  (retry succeeds)
    //  4. GET  /plugin/details  → 200  (updated listing)

    // After install completes the plugin should appear in the installed
    // section with a toggle switch. Wait for the full retry + refetch cycle.
    const installedCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: pluginName })
      .first()
    await expect(installedCard.getByRole('switch')).toBeVisible({
      timeout: 30000,
    })

    // The catalogue 503 → 200 retry should have happened
    expect(catalogue503Count).toBeGreaterThanOrEqual(1)
    expect(catalogue200Count).toBeGreaterThanOrEqual(1)
  })
})
