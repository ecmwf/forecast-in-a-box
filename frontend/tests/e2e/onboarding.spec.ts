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
 * First-run onboarding e2e — raw @playwright/test on purpose: fixtures.ts
 * suppresses the dialog for every other spec, this one exercises it.
 * The mock's seeded runs would mark a fresh visit as existing, so tests hide
 * them via the `fiab.mock.empty-runs` seam.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const WELCOME_TITLE = 'Welcome to Forecast-in-a-Box'

interface VisitOptions {
  onboarding?: Record<string, unknown>
  keepSeededRuns?: boolean
}

async function visitOverview(page: Page, options: VisitOptions = {}) {
  const { onboarding, keepSeededRuns = false } = options
  await page.addInitScript(
    ([state, keepRuns]) => {
      if (!keepRuns) {
        window.localStorage.setItem('fiab.mock.empty-runs', '1')
      }
      if (state) {
        window.localStorage.setItem(
          'fiab.store.onboarding',
          JSON.stringify({ state, version: 2 }),
        )
      }
    },
    [onboarding ?? null, keepSeededRuns] as const,
  )
  await page.goto('/')
  await page.waitForURL(/overview/, { timeout: 15000 })
}

async function readOnboardingStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('fiab.store.onboarding')
    if (!raw) return null
    return (
      (JSON.parse(raw) as { state?: { status?: string } }).state?.status ?? null
    )
  })
}

test.describe('First-run onboarding', () => {
  test('a fresh visit walks the tour page by page into a real start', async ({
    page,
  }) => {
    await visitOverview(page)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(WELCOME_TITLE)).toBeVisible({
      timeout: 15000,
    })
    await dialog.getByRole('button', { name: 'Take the tour' }).click()

    // The guided part runs as coachmarks on the real pages.
    const card = page.locator('[data-tour-card]')
    await expect(
      card.getByRole('heading', { name: 'Your dashboard, at a glance' }),
    ).toBeVisible()
    await expect(card.getByText('1 of 5', { exact: true })).toBeVisible()
    const pages = [
      ['/configure', 'Compose forecasts from blocks'],
      ['/execute', 'Run it, then inspect results in place'],
      ['/visualise', 'Visualise and compare on the map'],
      ['/overview', 'Run your first forecast'],
    ] as const
    for (const [i, [path, title]] of pages.entries()) {
      await card
        .getByRole('button', { name: i === 0 ? 'Start' : 'Next' })
        .click()
      await page.waitForURL(new RegExp(`${path}(\\?|$)`), { timeout: 15000 })
      await expect(card.getByRole('heading', { name: title })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Start from Scratch' }).click()
    await page.waitForURL(/configure\?.*fresh=true/, { timeout: 15000 })
    await expect(card).not.toBeVisible()
    expect(await readOnboardingStatus(page)).toBe('active')
  })

  test('plain dismissal snoozes: hidden on reload, status persisted', async ({
    page,
  }) => {
    await visitOverview(page)
    await expect(page.getByText(WELCOME_TITLE)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()
    expect(await readOnboardingStatus(page)).toBe('snoozed')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()
  })

  test('the checkbox makes dismissal permanent', async ({ page }) => {
    await visitOverview(page)
    await expect(page.getByText(WELCOME_TITLE)).toBeVisible({ timeout: 15000 })

    await page.getByText("Don't show this again").click()
    await page.getByRole('button', { name: 'Skip for now' }).click()

    expect(await readOnboardingStatus(page)).toBe('skipped')
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()
  })

  test('a snoozed dialog reappears once the cooldown elapses', async ({
    page,
  }) => {
    await visitOverview(page, {
      onboarding: {
        status: 'snoozed',
        snoozedAt: Date.now() - 25 * 3600 * 1000,
        snoozeCount: 1,
      },
    })

    await expect(page.getByText(WELCOME_TITLE)).toBeVisible({ timeout: 15000 })
  })

  test('deep links never trigger the dialog', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('fiab.mock.empty-runs', '1')
      // Pre-seed the anonymous session so the route guard lets the deep
      // link through without bouncing over /overview first.
      window.localStorage.setItem(
        'fiab.auth.anonymous-id',
        'e2e00000-1111-4222-8333-444455556666',
      )
    })
    await page.goto('/execute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()
    expect(await readOnboardingStatus(page)).not.toBe('skipped')
  })

  test('the settings menu reopens the tour after a permanent skip', async ({
    page,
  }) => {
    await visitOverview(page, {
      onboarding: { status: 'skipped' },
      keepSeededRuns: true,
    })
    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('menuitem', { name: 'Show welcome tour' }).click()

    await expect(page.getByText(WELCOME_TITLE)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Reopened from Help')).toBeVisible()
    // Closing a manual reopen leaves the opt-out untouched.
    await page.keyboard.press('Escape')
    await expect(page.getByText(WELCOME_TITLE)).not.toBeVisible()
    expect(await readOnboardingStatus(page)).toBe('skipped')
  })
})
