/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthenticatedHeader } from '@/components/layout/AuthenticatedHeader'
import { AuthContext } from '@/features/auth/AuthContext'

function auth(authType: AuthContextValue['authType']): AuthContextValue {
  return {
    isLoading: false,
    isAuthenticated: true,
    authType,
    signIn: () => {},
    signOut: () => Promise.resolve(),
  }
}

async function openSettings(authType: AuthContextValue['authType']) {
  const screen = await renderWithRouter(
    <AuthContext.Provider value={auth(authType)}>
      <AuthenticatedHeader />
    </AuthContext.Provider>,
  )
  await screen.getByRole('button', { name: 'Settings' }).click()
  await expect
    .element(screen.getByRole('menuitem', { name: 'Show welcome tour' }))
    .toBeVisible()
  return screen
}

describe('AuthenticatedHeader settings menu', () => {
  it('offers sign-out when signed in via SSO', async () => {
    const screen = await openSettings('authenticated')

    await expect
      .element(screen.getByRole('menuitem', { name: 'Sign out' }))
      .toBeVisible()
  })

  it('hides sign-out in passthrough mode, which has no session', async () => {
    const screen = await openSettings('anonymous')

    expect(
      screen.getByRole('menuitem', { name: 'Sign out' }).elements(),
    ).toHaveLength(0)
  })
})
