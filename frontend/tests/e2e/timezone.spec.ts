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
 * Application Timezone E2E Tests
 *
 * Verifies the timezone preference end-to-end: it defaults to UTC regardless of
 * the *browser* timezone, can be changed via the Settings dialog, and persists
 * across reloads. The browser timezone is varied via Playwright `timezoneId`.
 * Uses MSW mocks for API responses.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Zustand persistence key for the UI store (see src/lib/storage-keys.ts).
const UI_STORE_KEY = 'fiab.store.ui'

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

/** Read the persisted application timezone from localStorage. */
async function readAppTimeZone(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
      return (
        (JSON.parse(raw) as { state?: { timeZone?: string } }).state
          ?.timeZone ?? null
      )
    } catch {
      return null
    }
  }, UI_STORE_KEY)
}

// The app timezone must default to UTC no matter where the browser is.
for (const browserZone of [
  'UTC',
  'America/New_York',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
]) {
  test.describe(`browser timezone ${browserZone}`, () => {
    test.use({ timezoneId: browserZone })

    test('app timezone defaults to UTC', async ({ page }) => {
      await gotoDashboard(page)

      expect(await readAppTimeZone(page)).toBe('UTC')

      // The Settings menu surfaces the active zone as plain "UTC".
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(
        page.getByRole('menuitem', { name: /Timezone/i }),
      ).toContainText('UTC')
    })
  })
}

test.describe('changing the application timezone', () => {
  // A deliberately non-UTC browser, to prove the choice is independent of it.
  test.use({ timezoneId: 'America/New_York' })

  test('selecting a zone applies it and persists across a reload', async ({
    page,
  }) => {
    await gotoDashboard(page)

    // Open Settings -> Timezone dialog.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('menuitem', { name: /Timezone/i }).click()

    // Search for and select Europe/Berlin.
    await page.getByLabel('Search timezone').fill('Berlin')
    await page.getByRole('option', { name: /Europe.Berlin/ }).click()

    // The store reflects the selection.
    await expect.poll(() => readAppTimeZone(page)).toBe('Europe/Berlin')

    // The Settings menu now shows a non-UTC (UTC+) offset.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(
      page.getByRole('menuitem', { name: /Timezone/i }),
    ).toContainText('UTC+')
    await page.keyboard.press('Escape')

    // The selection survives a full reload.
    await page.reload()
    await page.waitForLoadState('networkidle')
    expect(await readAppTimeZone(page)).toBe('Europe/Berlin')
  })
})
