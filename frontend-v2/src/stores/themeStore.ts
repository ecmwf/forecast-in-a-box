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
