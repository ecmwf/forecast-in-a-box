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
 * Persisted UI preferences for the fable builder. Stored in localStorage
 * so they survive page reloads and browser restarts. Separate from the
 * main fableBuilderStore to keep persistence scoped to visual preferences
 * (not fable data or selection state).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const LEFT_MIN = 200
const LEFT_MAX = 400
const LEFT_DEFAULT = 256 // w-64
const RIGHT_MIN = 280
const RIGHT_MAX = 500
const RIGHT_DEFAULT = 320 // w-80

interface UiPreferencesState {
  leftSidebarWidth: number
  rightSidebarWidth: number
  setLeftSidebarWidth: (width: number) => void
  setRightSidebarWidth: (width: number) => void
  resetLeftSidebarWidth: () => void
  resetRightSidebarWidth: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      leftSidebarWidth: LEFT_DEFAULT,
      rightSidebarWidth: RIGHT_DEFAULT,
      setLeftSidebarWidth: (width) =>
        set({ leftSidebarWidth: clamp(width, LEFT_MIN, LEFT_MAX) }),
      setRightSidebarWidth: (width) =>
        set({ rightSidebarWidth: clamp(width, RIGHT_MIN, RIGHT_MAX) }),
      resetLeftSidebarWidth: () => set({ leftSidebarWidth: LEFT_DEFAULT }),
      resetRightSidebarWidth: () => set({ rightSidebarWidth: RIGHT_DEFAULT }),
    }),
    {
      name: STORAGE_KEYS.stores.fableBuilderUi,
      partialize: (state) => ({
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
      }),
    },
  ),
)

export { LEFT_MIN, LEFT_MAX, RIGHT_MIN, RIGHT_MAX }
