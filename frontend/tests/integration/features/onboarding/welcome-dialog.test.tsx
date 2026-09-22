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
 * WelcomeDialog integration — the hand-over to the guided welcome tour and
 * the snooze-vs-skip dismissal paths.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { WelcomeDialog } from '@/features/onboarding/components/WelcomeDialog'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useTutorialsStore } from '@/stores/tutorialsStore'

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

function withAuth(ui: React.ReactNode) {
  return <AuthContext.Provider value={anonymousAuth}>{ui}</AuthContext.Provider>
}

describe('WelcomeDialog', () => {
  // Browser-mode tests render without the app stylesheet, so the dialog loses
  // its Tailwind `fixed`/`z-50` positioning while Base UI's modal backdrop
  // keeps its inline `position: fixed`. Restore the dialog's production
  // stacking so the backdrop can't paint over the popup and swallow clicks.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;max-height:100vh;overflow:auto}'
    document.head.appendChild(style)
  })

  it('"Take the tour" closes the card and starts the guided welcome tour', async () => {
    const screen = await renderWithRouter(withAuth(<WelcomeDialog />))

    await expect
      .element(screen.getByText('Welcome to Forecast-in-a-Box'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Take the tour' }).click()

    expect(useTutorialsStore.getState().active).toEqual({
      id: 'welcome-tour',
      stepIndex: 0,
    })
    // The card's own decision is a plain dismissal; the tour runs on its own.
    expect(useOnboardingStore.getState().welcomeOpen).toBe(false)
    expect(useOnboardingStore.getState().status).toBe('snoozed')
  })

  it('the checkbox makes a tour start a permanent skip of the card', async () => {
    const screen = await renderWithRouter(withAuth(<WelcomeDialog />))

    await screen.getByText("Don't show this again").click()
    await screen.getByRole('button', { name: 'Take the tour' }).click()

    expect(useOnboardingStore.getState().status).toBe('skipped')
    expect(useTutorialsStore.getState().active?.id).toBe('welcome-tour')
  })

  it('"Skip for now" snoozes with a timestamp', async () => {
    const screen = await renderWithRouter(withAuth(<WelcomeDialog />))

    await screen.getByRole('button', { name: 'Skip for now' }).click()

    const state = useOnboardingStore.getState()
    expect(state.status).toBe('snoozed')
    expect(state.snoozeCount).toBe(1)
    expect(state.snoozedAt).not.toBeNull()
    expect(useTutorialsStore.getState().active).toBeNull()
  })

  it('the checkbox turns dismissal into a permanent skip', async () => {
    const screen = await renderWithRouter(withAuth(<WelcomeDialog />))

    await screen.getByText("Don't show this again").click()
    await screen.getByRole('button', { name: 'Skip for now' }).click()

    expect(useOnboardingStore.getState().status).toBe('skipped')
  })

  it('a reopen from a decided state swaps the checkbox for the Help note', async () => {
    useOnboardingStore.getState().skip()
    useOnboardingStore.getState().openWelcome()
    const screen = await renderWithRouter(withAuth(<WelcomeDialog />))

    await expect
      .element(screen.getByText('Welcome to Forecast-in-a-Box'))
      .toBeVisible()
    expect(screen.getByText("Don't show this again").query()).toBeNull()
    await expect.element(screen.getByText(/Reopened from Help/)).toBeVisible()
    // The dismiss button drops its snooze framing on a manual reopen.
    expect(
      screen.getByRole('button', { name: 'Skip for now' }).query(),
    ).toBeNull()
  })
})
