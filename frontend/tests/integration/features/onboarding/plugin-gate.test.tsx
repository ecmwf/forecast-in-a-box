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
 * Fresh-instance plugin gate on the final step — admins get the install CTA,
 * non-admins the "ask your administrator" copy (mock /users/me is not a
 * superuser, anonymous sessions count as admin).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { WelcomeDialog } from '@/features/onboarding/components/WelcomeDialog'
import { useOnboardingStore } from '@/stores/onboardingStore'

const baseAuth = {
  isLoading: false,
  isAuthenticated: true,
  signIn: () => {},
  signOut: () => Promise.resolve(),
}
const anonymousAuth: AuthContextValue = { ...baseAuth, authType: 'anonymous' }
const authenticatedAuth: AuthContextValue = {
  ...baseAuth,
  authType: 'authenticated',
}

function renderGated(auth: AuthContextValue) {
  return renderWithRouter(
    <AuthContext.Provider value={auth}>
      <WelcomeDialog pluginStepNeeded />
    </AuthContext.Provider>,
  )
}

describe('WelcomeDialog plugin gate', () => {
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;max-height:100vh;overflow:auto}'
    document.head.appendChild(style)
  })

  it('admins get the install CTA and it activates onboarding', async () => {
    const screen = await renderGated(anonymousAuth)

    await screen.getByRole('button', { name: 'Go to step 6' }).click()
    await expect
      .element(screen.getByText('No plugins are installed yet'))
      .toBeVisible()
    await expect
      .element(screen.getByText(/Presets come from plugins/))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Go to plugins' }).click()
    expect(useOnboardingStore.getState().status).toBe('active')
  })

  it('non-admins get the locked copy; acknowledging skips', async () => {
    const screen = await renderGated(authenticatedAuth)

    await screen.getByRole('button', { name: 'Go to step 6' }).click()
    await expect
      .element(screen.getByText(/An administrator needs to install/))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Got it' }).click()
    expect(useOnboardingStore.getState().status).toBe('skipped')
  })
})
