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
 * WelcomeDialog integration — six-step tour navigation, snooze-vs-skip
 * dismissal, and the preset handover against MSW starter templates.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { WelcomeDialog } from '@/features/onboarding/components/WelcomeDialog'
import { useOnboardingStore } from '@/stores/onboardingStore'

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

  it('walks the six steps and lands on the real starter presets', async () => {
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

    await expect
      .element(screen.getByText('Welcome to Forecast-in-a-Box'))
      .toBeVisible()
    await expect.element(screen.getByText('1 of 6')).toBeVisible()

    await screen.getByRole('button', { name: 'Take the tour' }).click()
    await expect
      .element(screen.getByText('Your dashboard, at a glance'))
      .toBeVisible()

    const titles = [
      'Compose forecasts from blocks',
      'Run it, then inspect results in place',
      'Visualise and compare on the map',
      'Run your first forecast',
    ]
    for (const title of titles) {
      await screen.getByRole('button', { name: 'Continue' }).click()
      await expect.element(screen.getByText(title)).toBeVisible()
    }

    await expect.element(screen.getByText('6 of 6')).toBeVisible()
    await expect
      .element(screen.getByTestId('onboarding-preset-card').first())
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Open in Configure' }))
      .toBeVisible()
  })

  it('the dots jump straight to a step', async () => {
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

    await screen.getByRole('button', { name: 'Go to step 5' }).click()
    await expect
      .element(screen.getByText('Visualise and compare on the map'))
      .toBeVisible()
  })

  it('"Skip for now" snoozes with a timestamp', async () => {
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

    await screen.getByRole('button', { name: 'Skip for now' }).click()
    const state = useOnboardingStore.getState()
    expect(state.status).toBe('snoozed')
    expect(state.snoozeCount).toBe(1)
    expect(state.snoozedAt).not.toBeNull()
  })

  it('the checkbox turns dismissal into a permanent skip', async () => {
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

    await screen.getByText("Don't show this again").click()
    await screen.getByRole('button', { name: 'Skip for now' }).click()
    expect(useOnboardingStore.getState().status).toBe('skipped')
  })

  it('"Open in Configure" activates onboarding with the selected preset', async () => {
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

    await screen.getByRole('button', { name: 'Go to step 6' }).click()
    const firstCard = screen.getByTestId('onboarding-preset-card').first()
    await expect.element(firstCard).toBeVisible()
    const selectedName = firstCard.element().getAttribute('aria-label')
    await firstCard.click()
    await screen.getByRole('button', { name: 'Open in Configure' }).click()

    expect(useOnboardingStore.getState().status).toBe('active')
    expect(selectedName).toBeTruthy()
  })

  it('a reopen from a decided state swaps the checkbox for the Help note', async () => {
    useOnboardingStore.getState().skip()
    useOnboardingStore.getState().openWelcome()
    const screen = await renderWithRouter(
      withAuth(<WelcomeDialog pluginStepNeeded={false} />),
    )

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
