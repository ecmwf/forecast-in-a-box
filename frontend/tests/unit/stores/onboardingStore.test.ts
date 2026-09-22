/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SNOOZE_CAP, useOnboardingStore } from '@/stores/onboardingStore'

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset()
  })

  it('starts pristine', () => {
    const state = useOnboardingStore.getState()
    expect(state.status).toBe('not-started')
    expect(state.welcomeOpen).toBe(false)
    expect(state.snoozedAt).toBeNull()
    expect(state.snoozeCount).toBe(0)
  })

  it('plain close snoozes: stamps snoozedAt and counts', () => {
    const store = useOnboardingStore
    const before = Date.now()
    store.getState().closeWelcome(false)
    const state = store.getState()
    expect(state.status).toBe('snoozed')
    expect(state.snoozeCount).toBe(1)
    expect(state.snoozedAt).toBeGreaterThanOrEqual(before)
  })

  it('checkbox close skips permanently', () => {
    useOnboardingStore.getState().closeWelcome(true)
    expect(useOnboardingStore.getState().status).toBe('skipped')
    expect(useOnboardingStore.getState().snoozeCount).toBe(0)
  })

  it(`the ${SNOOZE_CAP}th plain close converts to a permanent skip`, () => {
    const store = useOnboardingStore
    for (let i = 0; i < SNOOZE_CAP - 1; i++) {
      store.getState().closeWelcome(false)
      expect(store.getState().status).toBe('snoozed')
    }
    store.getState().closeWelcome(false)
    expect(store.getState().status).toBe('skipped')
    expect(store.getState().snoozeCount).toBe(SNOOZE_CAP)
  })

  it('closing a manual reopen never mutates a decided status', () => {
    const store = useOnboardingStore
    store.getState().closeWelcome(true)
    store.getState().openWelcome()
    expect(store.getState().welcomeOpen).toBe(true)

    store.getState().closeWelcome(false)
    expect(store.getState().status).toBe('skipped')
    expect(store.getState().welcomeOpen).toBe(false)
    expect(store.getState().snoozeCount).toBe(0)
  })

  it('startForecast activates and closes the dialog', () => {
    useOnboardingStore.getState().openWelcome()
    useOnboardingStore.getState().startForecast()
    const state = useOnboardingStore.getState()
    expect(state.status).toBe('active')
    expect(state.welcomeOpen).toBe(false)
  })

  it('welcomeOpen is ephemeral: excluded from the persisted slice', () => {
    const store = useOnboardingStore
    store.getState().openWelcome()
    store.getState().closeWelcome(false)

    const persisted = JSON.parse(
      localStorage.getItem('fiab.store.onboarding') ?? '{}',
    ) as { state?: Record<string, unknown> }
    expect(persisted.state).toBeDefined()
    expect('welcomeOpen' in persisted.state!).toBe(false)
    expect(persisted.state!.status).toBe('snoozed')
    expect(persisted.state!.snoozedAt).toEqual(expect.any(Number))
  })
})
