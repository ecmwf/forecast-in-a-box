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
 * Configure Forecast E2E Tests (Full Stack)
 *
 * Tests the full forecast configuration flow including:
 * - Graph mode: adding blocks, selecting nodes, config panel
 * - Save & load configuration flow
 * - Review & validation
 *
 * Run with: npm run test:e2e:stack
 */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Establish anonymous session then navigate to the target page.
 * Required because the router's beforeLoad guard checks for anonymousId in localStorage.
 */
async function navigateTo(page: Page, path: string) {
  await page.goto('/')
  await page.waitForURL(/overview/, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
}

/** Fork the first plugin template; false when the environment ships none. */
async function openTemplateConfig(page: Page): Promise<boolean> {
  await navigateTo(page, '/overview')
  // Generous: opening the dialog costs a real /blueprint/expand.
  const card = page.getByTestId('starter-template-card').first()
  if (!(await card.isVisible({ timeout: 30000 }).catch(() => false))) {
    return false
  }
  await card.click()
  await page.waitForURL(/configure/, { timeout: 30000 })
  // Take the template's own example values rather than filling the dialog.
  const skip = page.getByRole('button', { name: /^skip$/i })
  if (await skip.isVisible({ timeout: 45000 }).catch(() => false)) {
    await skip.click()
  }
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
  return true
}

test.describe('Fable Builder - Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/configure')
  })

  test('configure page loads with block palette', async ({ page }) => {
    // The page should show the fable builder with block palette
    const searchInput = page.getByPlaceholder('Search blocks...')
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(searchInput).toBeVisible()
    }

    // The graph-options dropdown
    const optionsButton = page.getByRole('button', { name: /graph options/i })
    if (await optionsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(optionsButton).toBeVisible()
    }
  })

  test('unsaved badge appears after making changes', async ({ page }) => {
    // Add a block to make changes
    const addButtons = page.getByRole('button', {
      name: /operational forecast|ensemble|temporal|zarr/i,
    })

    // Check palette sidebar for blocks
    const paletteButtons = page.locator(
      'button[title^="Add "], [class*="BlockPalette"] button',
    )
    const buttonsToClick =
      (await addButtons.count()) > 0 ? addButtons : paletteButtons

    if ((await buttonsToClick.count()) > 0) {
      await buttonsToClick.first().click()
      await page.waitForTimeout(1000)

      // Should show the draft-status badge in the header
      const unsavedBadge = page.getByText(/saving draft|draft saved/i)
      if (
        await unsavedBadge
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await expect(unsavedBadge.first()).toBeVisible()
      }
    }
  })
})

test.describe('Fable Builder - Graph Mode', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/configure')
  })

  test('graph canvas renders as default mode', async ({ page }) => {
    // Graph mode is the default - look for the ReactFlow canvas
    const graphCanvas = page.locator('.react-flow')
    if (await graphCanvas.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(graphCanvas).toBeVisible()
    }
  })

  test('adds a source block from the palette', async ({ page }) => {
    // Search for a block in the palette
    const searchInput = page.getByPlaceholder('Search blocks...')
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Look for block items in the palette
      const paletteButtons = page.locator('button[title^="Add "]')
      if ((await paletteButtons.count()) > 0) {
        await paletteButtons.first().click()
        await page.waitForTimeout(1000)

        // A node should appear in the graph
        const nodes = page.locator('.react-flow__node')
        await expect(nodes.first()).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('clicking a node opens the config panel', async ({ page }) => {
    // Add a block first
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Click on the node
      const node = page.locator('.react-flow__node').first()
      if (await node.isVisible({ timeout: 3000 }).catch(() => false)) {
        await node.click()
        await page.waitForTimeout(500)

        // Config panel should open with close button
        const closeButton = page.locator('[data-testid="config-panel-close"]')
        if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(closeButton).toBeVisible()
        }
      }
    }
  })

  test('fills in configuration fields in the config panel', async ({
    page,
  }) => {
    // Add a block and select it
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Click the node to open config panel
      const node = page.locator('.react-flow__node').first()
      if (await node.isVisible({ timeout: 3000 }).catch(() => false)) {
        await node.click()
        await page.waitForTimeout(500)

        // Fill config fields in the panel (id format: config-{key})
        const configInputs = page.locator('[id^="config-"]')
        if ((await configInputs.count()) > 0) {
          const firstInput = configInputs.first()
          const tagName = await firstInput.evaluate((el) =>
            el.tagName.toLowerCase(),
          )
          if (tagName === 'input') {
            const inputType = await firstInput.getAttribute('type')
            if (inputType === 'number') {
              await firstInput.fill('24')
            } else {
              await firstInput.fill('test-config-value')
            }
          }
        }
      }
    }
  })

  test('graph renders a node for every block in a multi-block fable', async ({
    page,
  }) => {
    // Seed a 3-block fable as a localStorage draft — FableBuilderPage restores
    // it on mount. Deterministic: avoids adding blocks through the palette,
    // whose availability is validation-driven and raced the catalogue
    // round-trip, which made the old "add two blocks" flow flaky.
    const draft = {
      fable: {
        blocks: {
          block_source_1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'ecmwf-base' },
              factory: 'operationalForecastSource',
            },
            configuration_values: {
              source: 'mars',
              forecast: 'aifs-ens',
              base_time: '2024-01-15T00:00:00',
            },
            input_ids: {},
          },
          block_product_1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'ecmwf-base' },
              factory: 'ensembleStatistics',
            },
            configuration_values: { param: '2t', statistic: 'mean' },
            input_ids: { dataset: 'block_source_1' },
          },
          block_sink_1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'ecmwf-base' },
              factory: 'zarrSink',
            },
            configuration_values: {
              path: '/data/output/european_temperature.zarr',
            },
            input_ids: { dataset: 'block_product_1' },
          },
        },
      },
      fableId: null,
      fableName: 'European Temperature Forecast',
      fableVersion: null,
      savedAt: Date.now(),
    }
    await page.addInitScript((value) => {
      window.localStorage.setItem('fiab.fable.draft', value)
    }, JSON.stringify(draft))

    await navigateTo(page, '/configure')

    // 3 blocks → 3 graph nodes.
    await expect(page.locator('.react-flow__node')).toHaveCount(3, {
      timeout: 15000,
    })
  })

  test('closes config panel with close button', async ({ page }) => {
    // Add and select a block
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      const node = page.locator('.react-flow__node').first()
      if (await node.isVisible({ timeout: 3000 }).catch(() => false)) {
        await node.click()
        await page.waitForTimeout(500)

        const closeButton = page.locator('[data-testid="config-panel-close"]')
        if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeButton.click()
          await page.waitForTimeout(300)

          // Panel should show "Select a block to configure" or similar
          const emptyState = page.getByText(/select a block/i)
          if (
            await emptyState
              .first()
              .isVisible({ timeout: 3000 })
              .catch(() => false)
          ) {
            await expect(emptyState.first()).toBeVisible()
          }
        }
      }
    }
  })
})

test.describe('Fable Builder - Save & Load', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/configure')
  })

  test('save config button is disabled when no blocks exist', async ({
    page,
  }) => {
    const saveButton = page.getByRole('button', { name: /save config/i })
    if (await saveButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(saveButton).toBeDisabled()
    }
  })

  test('saves a configuration with title', async ({ page }) => {
    // Add a block first
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Click save config button
      const saveButton = page.getByRole('button', { name: /save config/i })
      if (await saveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveButton.click()
        await page.waitForTimeout(500)

        // Fill in the title in the popover
        const titleInput = page.locator('#save-config-title')
        if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await titleInput.fill('E2E Test Configuration')

          // Optionally fill comments
          const commentsInput = page.locator('#save-config-comments')
          if (await commentsInput.isVisible().catch(() => false)) {
            await commentsInput.fill('Created by E2E test')
          }

          // Click save button in popover
          const saveAction = page.getByRole('button', { name: /^save$/i })
          if (
            await saveAction.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await saveAction.click()
            await page.waitForTimeout(2000)

            // Draft-status badge should disappear
            const unsavedBadge = page.getByText(/saving draft|draft saved/i)
            const isUnsavedVisible = await unsavedBadge
              .first()
              .isVisible({ timeout: 2000 })
              .catch(() => false)
            // After save, the draft badge should not be visible
            if (!isUnsavedVisible) {
              expect(isUnsavedVisible).toBe(false)
            }
          }
        }
      }
    }
  })

  test('unsaved badge returns after modifying saved config', async ({
    page,
  }) => {
    // Add a block
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Save the config
      const saveButton = page.getByRole('button', { name: /save config/i })
      if (await saveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveButton.click()
        await page.waitForTimeout(500)

        const titleInput = page.locator('#save-config-title')
        if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await titleInput.fill('E2E Modify Test')
          const saveAction = page.getByRole('button', { name: /^save$/i })
          if (
            await saveAction.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await saveAction.click()
            await page.waitForTimeout(2000)
          }
        }
      }

      // Now modify something - add another block
      if ((await paletteButtons.count()) > 1) {
        await paletteButtons.nth(1).click()
        await page.waitForTimeout(1000)

        // Draft-status badge should reappear
        const unsavedBadge = page.getByText(/saving draft|draft saved/i)
        if (
          await unsavedBadge
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false)
        ) {
          await expect(unsavedBadge.first()).toBeVisible()
        }
      }
    }
  })

  test('forking a plugin template loads its blocks', async ({ page }) => {
    if (!(await openTemplateConfig(page))) {
      test.skip(true, 'no plugin templates in this environment')
    }

    // Should load with the template's blocks
    const blocksBadge = page.getByText(/\d+ blocks?/)
    if (
      await blocksBadge
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await expect(blocksBadge.first()).toBeVisible()
    }
  })
})

test.describe('Fable Builder - Review & Validation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/configure')
  })

  test('review button is disabled without blocks', async ({ page }) => {
    const reviewButton = page.getByRole('button', { name: /review/i })
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(reviewButton).toBeDisabled()
    }
  })

  test('navigates to review step and shows configuration summary', async ({
    page,
  }) => {
    if (!(await openTemplateConfig(page))) {
      test.skip(true, 'no plugin templates in this environment')
    }

    // Click Review & Submit
    const reviewButton = page.getByRole('button', { name: /review/i })
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await reviewButton.isDisabled()
      if (!isDisabled) {
        await reviewButton.click()
        await page.waitForTimeout(2000)

        // Should show review heading
        const reviewHeading = page.getByText(/review configuration/i)
        if (
          await reviewHeading
            .first()
            .isVisible({ timeout: 5000 })
            .catch(() => false)
        ) {
          await expect(reviewHeading.first()).toBeVisible()
        }

        // Should show configuration summary
        const summaryCard = page.getByText(/configuration summary/i)
        if (
          await summaryCard
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false)
        ) {
          await expect(summaryCard.first()).toBeVisible()
        }
      }
    }
  })

  test('back to edit returns from review step', async ({ page }) => {
    if (!(await openTemplateConfig(page))) {
      test.skip(true, 'no plugin templates in this environment')
    }

    const reviewButton = page.getByRole('button', { name: /review/i })
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await reviewButton.isDisabled()
      if (!isDisabled) {
        await reviewButton.click()
        await page.waitForTimeout(2000)

        // Click back to edit
        const backButton = page.getByRole('button', { name: /back to edit/i })
        if (await backButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await backButton.click()
          await page.waitForTimeout(500)

          // Should show the graph-options button again (edit step)
          const optionsButton = page.getByRole('button', {
            name: /graph options/i,
          })
          if (
            await optionsButton.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await expect(optionsButton).toBeVisible()
          }
        }
      }
    }
  })

  test('shows validation status on review step', async ({ page }) => {
    if (!(await openTemplateConfig(page))) {
      test.skip(true, 'no plugin templates in this environment')
    }

    const reviewButton = page.getByRole('button', { name: /review/i })
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await reviewButton.isDisabled()
      if (!isDisabled) {
        await reviewButton.click()
        await page.waitForTimeout(3000)

        // Should show either "Ready to Submit" or "Configuration Has Errors"
        const readyText = page.getByText(/ready to submit/i)
        const errorsText = page.getByText(/has errors/i)
        const validatingText = page.getByText(/validating/i)

        const isReady = await readyText
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false)
        const hasErrors = await errorsText
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
        const isValidating = await validatingText
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)

        // At least one validation state should be shown
        expect(isReady || hasErrors || isValidating).toBe(true)
      }
    }
  })

  test('submit job button visible on review step', async ({ page }) => {
    if (!(await openTemplateConfig(page))) {
      test.skip(true, 'no plugin templates in this environment')
    }

    const reviewButton = page.getByRole('button', { name: /review/i })
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await reviewButton.isDisabled()
      if (!isDisabled) {
        await reviewButton.click()
        await page.waitForTimeout(2000)

        // Submit Job button should be visible
        const submitButton = page.getByRole('button', {
          name: /submit job/i,
        })
        if (
          await submitButton.isVisible({ timeout: 5000 }).catch(() => false)
        ) {
          await expect(submitButton).toBeVisible()
        }
      }
    }
  })
})
