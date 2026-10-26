/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { API_ENDPOINTS } from '@/api/endpoints'
import { AuthContext } from '@/features/auth/AuthContext'
import { GlyphsPage } from '@/features/glyphs/components/GlyphsPage'

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

/** Seed one global variable through the mock API. */
async function seedGlyph(key: string): Promise<void> {
  await fetch(API_ENDPOINTS.fable.glyphsGlobalPost, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: '42', public: false }),
  })
}

describe('GlyphsPage delete', () => {
  // No app stylesheet in browser-mode tests: restore the dialog stacking.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="alert-dialog-content"]{position:fixed;z-index:50;background:#fff}'
    document.head.appendChild(style)
  })

  beforeEach(async () => {
    await seedGlyph('answer')
    await seedGlyph('keeper')
  })

  it('removes a variable after confirmation', async () => {
    const screen = await renderWithRouter(
      <AuthContext.Provider value={anonymousAuth}>
        <GlyphsPage />
      </AuthContext.Provider>,
    )
    await expect.element(screen.getByText('${answer}')).toBeVisible()

    await screen.getByRole('button', { name: 'Delete answer' }).click()
    await expect
      .element(screen.getByRole('alertdialog', { name: 'Delete ${answer}?' }))
      .toBeVisible()
    await screen
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect.element(screen.getByText('${answer}')).not.toBeInTheDocument()
    await expect.element(screen.getByText('${keeper}')).toBeVisible()
  })

  it('keeps the variable when cancelled', async () => {
    const screen = await renderWithRouter(
      <AuthContext.Provider value={anonymousAuth}>
        <GlyphsPage />
      </AuthContext.Provider>,
    )
    await screen.getByRole('button', { name: 'Delete answer' }).click()
    await screen.getByRole('button', { name: 'Cancel' }).click()
    await expect
      .element(screen.getByRole('alertdialog'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('${answer}')).toBeVisible()
  })
})
