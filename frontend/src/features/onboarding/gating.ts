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
 * Pure decision logic for when the welcome dialog shows. The caller feeds
 * live signals; `now` is injected for testability.
 */

import type { OnboardingStatus } from '@/stores/onboardingStore'
import { SNOOZE_REAPPEAR_MS } from '@/stores/onboardingStore'

export interface GateSignals {
  status: OnboardingStatus
  /** Manual reopen (settings/Help) — bypasses route and status checks. */
  welcomeOpen: boolean
  snoozedAt: number | null
  pathname: string
  /** Query settled = success or error; the gate never acts on loading data. */
  catalogueSettled: boolean
  catalogueEmpty: boolean
  jobsSettled: boolean
  jobsTotal: number
}

export type GateDecision =
  | { kind: 'closed' }
  /** Signals not settled yet — show nothing, decide next render. */
  | { kind: 'wait' }
  /** Existing user (has runs) — silently skip, never show. */
  | { kind: 'grandfather' }
  | { kind: 'open'; pluginStepNeeded: boolean }

export function decideGate(signals: GateSignals, now: number): GateDecision {
  const {
    status,
    welcomeOpen,
    snoozedAt,
    pathname,
    catalogueSettled,
    catalogueEmpty,
    jobsSettled,
    jobsTotal,
  } = signals

  if (!welcomeOpen) {
    if (pathname !== '/overview') return { kind: 'closed' }
    if (status !== 'not-started' && status !== 'snoozed') {
      return { kind: 'closed' }
    }
    // Missing snoozedAt self-heals as due, showing at most once more.
    const cooldownActive =
      status === 'snoozed' &&
      snoozedAt !== null &&
      now - snoozedAt < SNOOZE_REAPPEAR_MS
    if (cooldownActive) return { kind: 'closed' }
  }

  // Both auto and manual opens wait for data: the final pane's branch
  // (templates vs plugin install) must be decidable before first paint.
  if (!catalogueSettled || !jobsSettled) return { kind: 'wait' }

  // Grandfather applies at first show AND at snooze-reshow time: someone
  // who ran forecasts on their own is done being onboarded.
  if (!welcomeOpen && jobsTotal > 0) return { kind: 'grandfather' }

  // Errors count as empty: a broken catalogue should pivot to plugin
  // guidance rather than promise template cards it cannot render.
  return { kind: 'open', pluginStepNeeded: catalogueEmpty }
}
