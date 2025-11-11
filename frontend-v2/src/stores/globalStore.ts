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
