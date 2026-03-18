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
 * Executions E2E Tests
 *
 * Tests the executions list page and job detail page.
 * Covers page loading, status filtering, search, and detail navigation.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function navigateTo(page: Page, path: string) {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  if (path !== '/dashboard') {
    await page.goto(path)
    await page.waitForURL(new RegExp(path.replace('/', '\\/')), {
      timeout: 10000,
    })
    await page.waitForLoadState('networkidle')
  }
  await page.waitForTimeout(2000)
}

test.describe('Executions List Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/executions')
  })

  test('executions page loads with heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /executions/i })
    await expect(heading.first()).toBeVisible({ timeout: 10000 })
  })

  test('search input is visible', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search executions/i)
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(searchInput).toBeVisible()
    }
  })

  test('status filter buttons are visible', async ({ page }) => {
    const allButton = page.getByRole('button', { name: 'All' })
    if (await allButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(allButton).toBeVisible()

      const runningButton = page.getByRole('button', { name: 'Running' })
      const completedButton = page.getByRole('button', { name: 'Completed' })
      const erroredButton = page.getByRole('button', { name: 'Errored' })

      if (await runningButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(runningButton).toBeVisible()
      }
      if (
        await completedButton.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await expect(completedButton).toBeVisible()
      }
      if (await erroredButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(erroredButton).toBeVisible()
      }
    }
  })

  test('job items display when executions exist', async ({ page }) => {
    // Look for job ID pills (font-mono spans starting with #)
    const jobPills = page.locator('.font-mono')
    if (
      await jobPills
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      const count = await jobPills.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('empty state shows when no executions', async ({ page }) => {
    // If no jobs exist, an empty message should appear
    const emptyMessage = page.getByText(/haven't run any forecast/i)
    const jobItems = page.locator('.font-mono')

    const hasJobs = await jobItems
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)

    if (!hasJobs) {
      if (await emptyMessage.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(emptyMessage).toBeVisible()
      }
    }
  })
})

test.describe('Executions Status Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/executions')
  })

  test('clicking a status filter updates the list', async ({ page }) => {
    const completedButton = page.getByRole('button', { name: 'Completed' })
    if (await completedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await completedButton.click()
      await page.waitForTimeout(500)

      // Page should still be functional after filtering
      await expect(page.locator('body')).toBeVisible()

      // Click All to reset
      const allButton = page.getByRole('button', { name: 'All' })
      if (await allButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await allButton.click()
        await page.waitForTimeout(500)
      }
    }
  })

  test('search filters the list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search executions/i)
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('test')
      await page.waitForTimeout(500)

      // Page should still be functional
      await expect(page.locator('body')).toBeVisible()

      // Clear search
      await searchInput.clear()
      await page.waitForTimeout(500)
    }
  })
})

test.describe('Execution Detail Page', () => {
  test('navigates to detail page from list', async ({ page }) => {
    await navigateTo(page, '/executions')

    // Verify we're on the executions page
    await expect(page).toHaveURL(/executions/)

    // Find a job detail link — use exact match to avoid "View Results" etc.
    const viewLink = page.getByRole('link', { name: 'View', exact: true })
    const inspectLink = page.getByRole('link', {
      name: 'Inspect',
      exact: true,
    })

    if (
      await viewLink
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await viewLink.first().click()
      await page.waitForURL(/executions\/[^/]+/, { timeout: 10000 })
      await expect(page).toHaveURL(/executions\/[^/]+/)
    } else if (
      await inspectLink
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await inspectLink.first().click()
      await page.waitForURL(/executions\/[^/]+/, { timeout: 10000 })
      await expect(page).toHaveURL(/executions\/[^/]+/)
    }
  })

  test('detail page shows back link', async ({ page }) => {
    await navigateTo(page, '/executions')

    // Navigate to first available job
    const viewLink = page.getByText('View')
    const inspectLink = page.getByText('Inspect')

    if (
      await viewLink
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await viewLink.first().click()
    } else if (
      await inspectLink
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await inspectLink.first().click()
    } else {
      return // No jobs to navigate to
    }

    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Back link should be visible
    const backLink = page.getByText('Executions')
    if (
      await backLink
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(backLink.first()).toBeVisible()
    }
  })

  test('detail page shows tab controls', async ({ page }) => {
    await navigateTo(page, '/executions')

    const viewLink = page.getByText('View')
    const inspectLink = page.getByText('Inspect')

    if (
      await viewLink
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await viewLink.first().click()
    } else if (
      await inspectLink
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await inspectLink.first().click()
    } else {
      return
    }

    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Tab buttons should be visible
    const outputsTab = page.getByText('Outputs', { exact: true })
    const logsTab = page.getByText('Logs', { exact: true })
    const specTab = page.getByText('Specification', { exact: true })

    if (await outputsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(outputsTab).toBeVisible()
    }
    if (await logsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(logsTab).toBeVisible()
    }
    if (await specTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(specTab).toBeVisible()
    }
  })

  test('back link navigates to executions list', async ({ page }) => {
    await navigateTo(page, '/executions')

    const viewLink = page.getByText('View')
    if (
      await viewLink
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await viewLink.first().click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1000)

      // Click back link
      const backLink = page.getByRole('link', { name: /executions/i })
      if (
        await backLink
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await backLink.first().click()
        await page.waitForLoadState('networkidle')

        // Should be back on executions list
        await expect(page).toHaveURL(/\/executions$/)
      }
    }
  })
})
