/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Global application store
 * Manages application-wide state that doesn't fit into specific features
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface GlobalState {
  // Application state
  isInitialized: boolean
  setIsInitialized: (value: boolean) => void

  // Internationalization
  locale: string
  setLocale: (locale: string) => void

  // UI state
  isSidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (value: boolean) => void

  // Reset store
  reset: () => void
}

const initialState = {
  isInitialized: false,
  locale: 'en',
  isSidebarOpen: true,
}

export const useGlobalStore = create<GlobalState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setIsInitialized: (value) => set({ isInitialized: value }),

        setLocale: (locale) => set({ locale }),

        toggleSidebar: () =>
          set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

        setSidebarOpen: (value) => set({ isSidebarOpen: value }),

        reset: () => set(initialState),
      }),
      {
        name: 'global-storage',
        partialize: (state) => ({ locale: state.locale }),
      },
    ),
    { name: 'GlobalStore' },
  ),
)
