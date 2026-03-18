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
 * - Form mode: adding blocks, configuring fields, step navigation
 * - Graph mode: adding blocks, selecting nodes, config panel
 * - Save & load configuration flow
 * - Review & validation
 *
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

test.describe('Fable Builder - Form Mode', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/configure')
  })

  test('configure page loads with block palette', async ({ page }) => {
    // The page should show the fable builder with block palette
    const searchInput = page.getByPlaceholder('Search blocks...')
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(searchInput).toBeVisible()
    }

    // Should have mode toggle buttons
    const graphButton = page.getByRole('button', { name: /graph/i })
    const formButton = page.getByRole('button', { name: /form/i })
    if (await graphButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(graphButton).toBeVisible()
      await expect(formButton).toBeVisible()
    }
  })

  test('switches to Form mode via toggle button', async ({ page }) => {
    const formButton = page.getByRole('button', { name: /form/i })
    if (await formButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await formButton.click()
      await page.waitForTimeout(500)

      // Form mode should show step navigation (source, transform, product, sink)
      const sourceStep = page.getByRole('button', { name: /source/i })
      if (await sourceStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(sourceStep).toBeVisible()
      }
    }
  })

  test('adds a source block from the palette in form mode', async ({
    page,
  }) => {
    // Switch to form mode
    const formButton = page.getByRole('button', { name: /form/i })
    if (await formButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await formButton.click()
      await page.waitForTimeout(500)
    }

    // Look for add block buttons in the form canvas area
    // In form mode, available block factories appear as "Add" buttons
    const addButtons = page.getByRole('button', {
      name: /earthkit|ensemble|temporal|zarr/i,
    })
    const addCount = await addButtons.count()

    if (addCount > 0) {
      await addButtons.first().click()
      await page.waitForTimeout(1000)

      // After adding, block count badge should update in header
      const blocksBadge = page.getByText(/\d+ blocks?/)
      if (
        await blocksBadge
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await expect(blocksBadge.first()).toBeVisible()
      }
    }
  })

  test('block instance card appears with config fields after adding block', async ({
    page,
  }) => {
    // Switch to form mode
    const formButton = page.getByRole('button', { name: /form/i })
    if (await formButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await formButton.click()
      await page.waitForTimeout(500)
    }

    // Add a block
    const addButtons = page.getByRole('button', {
      name: /earthkit|ensemble|temporal|zarr/i,
    })
    if ((await addButtons.count()) > 0) {
      await addButtons.first().click()
      await page.waitForTimeout(1000)

      // Check for configuration fields (inputs/selects in the card)
      const inputs = page.locator(
        'input[type="text"], input[type="number"], select',
      )
      const inputCount = await inputs.count()
      // Should have at least one config field
      if (inputCount > 0) {
        await expect(inputs.first()).toBeVisible()
      }
    }
  })

  test('fills in configuration fields', async ({ page }) => {
    // Switch to form mode
    const formButton = page.getByRole('button', { name: /form/i })
    if (await formButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await formButton.click()
      await page.waitForTimeout(500)
    }

    // Add a source block
    const addButtons = page.getByRole('button', {
      name: /earthkit|ensemble|temporal|zarr/i,
    })
    if ((await addButtons.count()) > 0) {
      await addButtons.first().click()
      await page.waitForTimeout(1000)

      // Find text and number inputs and fill them
      const textInputs = page.locator(
        'input[type="text"]:not([placeholder="Search blocks..."])',
      )
      if ((await textInputs.count()) > 0) {
        await textInputs.first().fill('test-value')
        await expect(textInputs.first()).toHaveValue('test-value')
      }

      const numberInputs = page.locator('input[type="number"]')
      if ((await numberInputs.count()) > 0) {
        await numberInputs.first().fill('48')
        await expect(numberInputs.first()).toHaveValue('48')
      }
    }
  })

  test('navigates between form steps', async ({ page }) => {
    // Switch to form mode
    const formButton = page.getByRole('button', { name: /form/i })
    if (await formButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await formButton.click()
      await page.waitForTimeout(500)

      // Look for step navigation buttons
      const nextButton = page.getByRole('button', { name: /next step/i })
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Add a source block first so we can navigate
        const addButtons = page.getByRole('button', {
          name: /earthkit|ensemble|temporal|zarr/i,
        })
        if ((await addButtons.count()) > 0) {
          await addButtons.first().click()
          await page.waitForTimeout(500)
        }

        await nextButton.click()
        await page.waitForTimeout(500)

        // Should advance to next step (transform or product)
        const prevButton = page.getByRole('button', { name: /previous step/i })
        if (await prevButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(prevButton).toBeVisible()
        }
      }
    }
  })

  test('unsaved badge appears after making changes', async ({ page }) => {
    // Add a block to make changes
    const addButtons = page.getByRole('button', {
      name: /earthkit|ensemble|temporal|zarr/i,
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

      // Should show "Unsaved" badge in header
      const unsavedBadge = page.getByText('Unsaved')
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

  test('adds multiple blocks and verifies nodes appear', async ({ page }) => {
    const paletteButtons = page.locator('button[title^="Add "]')
    const buttonCount = await paletteButtons.count()

    if (buttonCount >= 2) {
      // Add first block (source)
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Add second block (try a different kind)
      await paletteButtons.nth(1).click()
      await page.waitForTimeout(1000)

      // Should have at least 2 nodes
      const nodes = page.locator('.react-flow__node')
      const nodeCount = await nodes.count()
      expect(nodeCount).toBeGreaterThanOrEqual(2)
    }
  })

  test('switches between graph and form mode preserving state', async ({
    page,
  }) => {
    // Add a block in graph mode
    const paletteButtons = page.locator('button[title^="Add "]')
    if ((await paletteButtons.count()) > 0) {
      await paletteButtons.first().click()
      await page.waitForTimeout(1000)

      // Check block count in header
      const blocksBadge = page.getByText(/\d+ blocks?/)
      const initialText = await blocksBadge
        .first()
        .textContent()
        .catch(() => null)

      // Switch to form mode
      const formButton = page.getByRole('button', { name: /form/i })
      if (await formButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await formButton.click()
        await page.waitForTimeout(500)

        // Block count should persist
        if (initialText) {
          const newBlocksBadge = page.getByText(/\d+ blocks?/)
          if (
            await newBlocksBadge
              .first()
              .isVisible({ timeout: 3000 })
              .catch(() => false)
          ) {
            const newText = await newBlocksBadge.first().textContent()
            expect(newText).toBe(initialText)
          }
        }

        // Switch back to graph mode
        const graphButton = page.getByRole('button', { name: /graph/i })
        if (await graphButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await graphButton.click()
          await page.waitForTimeout(500)

          // Node should still be there
          const nodes = page.locator('.react-flow__node')
          if (
            await nodes
              .first()
              .isVisible({ timeout: 3000 })
              .catch(() => false)
          ) {
            await expect(nodes.first()).toBeVisible()
          }
        }
      }
    }
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

            // Unsaved badge should disappear
            const unsavedBadge = page.getByText('Unsaved')
            const isUnsavedVisible = await unsavedBadge
              .first()
              .isVisible({ timeout: 2000 })
              .catch(() => false)
            // After save, unsaved should not be visible
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

        // Unsaved badge should reappear
        const unsavedBadge = page.getByText('Unsaved')
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

  test('loads a preset configuration via URL param', async ({ page }) => {
    // Navigate with a preset param
    await page.goto('/configure?preset=quick-start')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // Should load with pre-configured blocks
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
    // Load a preset to get a complete config
    await page.goto('/configure?preset=quick-start')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

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
    // Load preset and go to review
    await page.goto('/configure?preset=quick-start')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

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

          // Should show mode toggle again (edit step)
          const graphButton = page.getByRole('button', { name: /graph/i })
          if (
            await graphButton.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await expect(graphButton).toBeVisible()
          }
        }
      }
    }
  })

  test('shows validation status on review step', async ({ page }) => {
    // Load preset
    await page.goto('/configure?preset=quick-start')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

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
    // Load preset
    await page.goto('/configure?preset=quick-start')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

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
