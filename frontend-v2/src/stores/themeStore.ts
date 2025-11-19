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
 * Theme store
 * Manages UI theme (dark/light mode) and theme-related preferences
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  // Current theme setting
  theme: Theme
  setTheme: (theme: Theme) => void

  // Actual applied theme (resolved from 'system')
  resolvedTheme: 'light' | 'dark'
  setResolvedTheme: (theme: 'light' | 'dark') => void

  // Toggle between light and dark
  toggleTheme: () => void
}

const initialState = {
  theme: 'system' as Theme,
  resolvedTheme: 'light' as 'light' | 'dark',
}

export const useThemeStore = create<ThemeState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setTheme: (theme) => set({ theme }),

        setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

        toggleTheme: () =>
          set((state) => {
            const newTheme = state.resolvedTheme === 'light' ? 'dark' : 'light'
            return {
              theme: newTheme,
              resolvedTheme: newTheme,
            }
          }),
      }),
      {
        name: 'theme-storage',
        partialize: (state) => ({ theme: state.theme }),
      },
    ),
    { name: 'ThemeStore' },
  ),
)
