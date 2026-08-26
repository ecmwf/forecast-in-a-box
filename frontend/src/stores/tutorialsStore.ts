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
 * Guided-tour state: which tutorials were completed or dismissed (persisted),
 * and which one is running right now (ephemeral). A relaunch never resumes a
 * stored step index — tours always restart at step 1, reviewing done steps.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

export type TutorialId = 'visualise-first-map'

export type TutorialOutcome = 'completed' | 'dismissed'

interface TutorialsState {
  /** Persisted outcome per tutorial; an absent key means never taken. */
  statuses: Partial<Record<TutorialId, TutorialOutcome>>
  /** Ephemeral (not persisted): the running tutorial, if any. */
  active: { id: TutorialId; stepIndex: number } | null

  start: (id: TutorialId) => void
  setStep: (stepIndex: number) => void
  /** Ends the run; `null` keeps the status; completed never downgrades. */
  finish: (outcome: TutorialOutcome | null) => void
  /** Back to a pristine state (tests, storage reset) */
  reset: () => void
}

const initialState = {
  statuses: {} as TutorialsState['statuses'],
  active: null,
}

export const useTutorialsStore = create<TutorialsState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        start: (id) => set({ active: { id, stepIndex: 0 } }),

        setStep: (stepIndex) =>
          set((state) =>
            state.active ? { active: { ...state.active, stepIndex } } : state,
          ),

        finish: (outcome) =>
          set((state) => {
            if (!state.active) return state
            const { id } = state.active
            if (outcome === null || state.statuses[id] === 'completed') {
              return { active: null }
            }
            return {
              active: null,
              statuses: { ...state.statuses, [id]: outcome },
            }
          }),

        reset: () => set({ ...initialState }),
      }),
      {
        name: STORAGE_KEYS.stores.tutorials,
        version: STORE_VERSIONS.tutorials,
        partialize: (state) => ({ statuses: state.statuses }),
      },
    ),
    { name: 'TutorialsStore' },
  ),
)
