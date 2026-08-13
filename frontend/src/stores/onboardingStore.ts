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
 * Persisted first-run onboarding state for the welcome tour.
 * Per-browser: anonymous sign-out mints a fresh user id but keeps this store.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

/** A snoozed welcome reappears on /overview once this much time has passed. */
export const SNOOZE_REAPPEAR_MS = 24 * 60 * 60 * 1000
/** Plain dismissals convert to a permanent skip after this many snoozes. */
export const SNOOZE_CAP = 3

export type OnboardingStatus =
  | 'not-started' // never seen — welcome dialog auto-opens on /overview
  | 'snoozed' // plainly dismissed — reappears after SNOOZE_REAPPEAR_MS
  | 'skipped' // opted out (checkbox / grandfathered / snooze cap) — never auto-reshows
  | 'active' // started a first forecast — never auto-reshows

interface OnboardingState {
  status: OnboardingStatus
  /** Ephemeral (not persisted): dialog opened via settings/Help reopen. */
  welcomeOpen: boolean
  /** Epoch ms of the last plain dismissal; drives the reappear cooldown. */
  snoozedAt: number | null
  snoozeCount: number
  /**
   * Whether the tour includes plugin-install guidance — frozen at first
   * open so the final step doesn't pop in or vanish; null = undetermined.
   */
  pluginStepNeeded: boolean | null

  /** Manual reopen (settings/Help) — never mutates the persisted status. */
  openWelcome: () => void
  /** Every dialog close path; `dontShowAgain` = the checkbox state. */
  closeWelcome: (dontShowAgain: boolean) => void
  /** Preset card / blank-canvas click — the tour did its job. */
  startForecast: () => void
  /** Admin CTA behind the fresh-instance plugin gate. */
  startPluginInstall: () => void
  /** Grandfathering and other silent opt-outs. */
  skip: () => void
  setPluginStepNeeded: (needed: boolean) => void
  /** Back to a pristine never-seen state (tests, storage reset) */
  reset: () => void
}

const initialState = {
  status: 'not-started' as OnboardingStatus,
  welcomeOpen: false,
  snoozedAt: null as number | null,
  snoozeCount: 0,
  pluginStepNeeded: null as boolean | null,
}

export const useOnboardingStore = create<OnboardingState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        openWelcome: () => set({ welcomeOpen: true }),

        closeWelcome: (dontShowAgain) =>
          set((state) => {
            // A reopen from an already-decided state must not resurrect
            // auto-reshow — only ever close the dialog.
            if (state.status !== 'not-started' && state.status !== 'snoozed') {
              return { welcomeOpen: false }
            }
            if (dontShowAgain) return { welcomeOpen: false, status: 'skipped' }
            const snoozeCount = state.snoozeCount + 1
            return {
              welcomeOpen: false,
              status: snoozeCount >= SNOOZE_CAP ? 'skipped' : 'snoozed',
              snoozedAt: Date.now(),
              snoozeCount,
            }
          }),

        startForecast: () => set({ status: 'active', welcomeOpen: false }),

        startPluginInstall: () => set({ status: 'active', welcomeOpen: false }),

        skip: () => set({ status: 'skipped', welcomeOpen: false }),

        setPluginStepNeeded: (pluginStepNeeded) => set({ pluginStepNeeded }),
        reset: () => set({ ...initialState }),
      }),
      {
        name: STORAGE_KEYS.stores.onboarding,
        version: STORE_VERSIONS.onboarding,
        partialize: (state) => ({
          status: state.status,
          snoozedAt: state.snoozedAt,
          snoozeCount: state.snoozeCount,
          pluginStepNeeded: state.pluginStepNeeded,
        }),
      },
    ),
    { name: 'OnboardingStore' },
  ),
)
