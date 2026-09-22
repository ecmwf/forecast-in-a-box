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
 * Shared e2e test base: suppresses the first-run welcome dialog and marks
 * the guided tour taken, so specs see the steady-state surfaces.
 * onboarding.spec.ts / tutorial-visualise.spec.ts import raw
 * @playwright/test instead to exercise these surfaces themselves.
 */

import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // Runs before every document load, so it also survives reloads.
    // Shapes must track STORE_VERSIONS.onboarding / STORE_VERSIONS.tutorials
    // (src/lib/storage-keys.ts).
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'fiab.store.onboarding',
        JSON.stringify({ state: { status: 'skipped' }, version: 2 }),
      )
      window.localStorage.setItem(
        'fiab.store.tutorials',
        JSON.stringify({
          state: {
            statuses: {
              'visualise-first-map': 'dismissed',
              'configure-first-run': 'dismissed',
            },
          },
          version: 1,
        }),
      )
    })
    await use(page)
  },
})

export { expect } from '@playwright/test'

/**
 * Skip a running tour. The coachmark re-anchors as the page settles, so a
 * single click can land where the button was; retry until the card is gone.
 */
export async function skipTour(page: Page, title: string): Promise<void> {
  const card = page.getByRole('dialog', { name: title })
  await expect(async () => {
    await card.getByRole('button', { name: 'Skip tour', exact: true }).click()
    await expect(card).toBeHidden({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
}
