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
import type { GateSignals } from '@/features/onboarding/gating'
import { decideGate } from '@/features/onboarding/gating'
import { SNOOZE_REAPPEAR_MS } from '@/stores/onboardingStore'

const NOW = 1_700_000_000_000

const base: GateSignals = {
  status: 'not-started',
  welcomeOpen: false,
  snoozedAt: null,
  pathname: '/overview',
  jobsSettled: true,
  jobsTotal: 0,
}

describe('decideGate', () => {
  it('opens for a fresh user on /overview with settled data', () => {
    expect(decideGate(base, NOW)).toEqual({ kind: 'open' })
  })

  it('never auto-opens off /overview', () => {
    expect(decideGate({ ...base, pathname: '/execute' }, NOW)).toEqual({
      kind: 'closed',
    })
  })

  it('waits while the jobs query is unsettled', () => {
    expect(decideGate({ ...base, jobsSettled: false }, NOW)).toEqual({
      kind: 'wait',
    })
  })

  it('skips users who already have runs', () => {
    expect(decideGate({ ...base, jobsTotal: 3 }, NOW)).toEqual({
      kind: 'existing-user',
    })
  })

  it('stays closed for skipped / active', () => {
    for (const status of ['skipped', 'active'] as const) {
      expect(decideGate({ ...base, status }, NOW)).toEqual({ kind: 'closed' })
    }
  })

  it('snoozed: closed inside the cooldown, open once it elapses', () => {
    const snoozed = { ...base, status: 'snoozed' as const }
    expect(
      decideGate(
        { ...snoozed, snoozedAt: NOW - SNOOZE_REAPPEAR_MS + 60_000 },
        NOW,
      ),
    ).toEqual({ kind: 'closed' })
    expect(
      decideGate(
        { ...snoozed, snoozedAt: NOW - SNOOZE_REAPPEAR_MS - 60_000 },
        NOW,
      ),
    ).toEqual({ kind: 'open' })
  })

  it('a missing snooze timestamp self-heals as due', () => {
    expect(
      decideGate({ ...base, status: 'snoozed', snoozedAt: null }, NOW),
    ).toEqual({ kind: 'open' })
  })

  it('re-checks for prior runs at snooze-reshow time', () => {
    expect(
      decideGate(
        {
          ...base,
          status: 'snoozed',
          snoozedAt: NOW - SNOOZE_REAPPEAR_MS - 1,
          jobsTotal: 1,
        },
        NOW,
      ),
    ).toEqual({ kind: 'existing-user' })
  })

  it('manual welcomeOpen bypasses route, status, and the run check', () => {
    expect(
      decideGate(
        {
          ...base,
          welcomeOpen: true,
          status: 'skipped',
          pathname: '/visualise',
          jobsTotal: 9,
        },
        NOW,
      ),
    ).toEqual({ kind: 'open' })
  })

  it('manual open never waits: it never checks prior runs', () => {
    expect(
      decideGate(
        { ...base, welcomeOpen: true, status: 'skipped', jobsSettled: false },
        NOW,
      ),
    ).toEqual({ kind: 'open' })
  })
})
