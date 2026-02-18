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
 * UI Store
 *
 * Manages all UI-related state including theme, layout, and application initialization.
 * Merges functionality from the previous globalStore and themeStore.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

export type Theme = 'light' | 'dark' | 'system'
export type LayoutMode = 'fluid' | 'boxed'
export type DashboardVariant = 'default' | 'flat' | 'modern' | 'gradient'
export type PanelShadow = 'none' | 'sm' | 'md' | 'lg'
export type AdminViewMode = 'table' | 'card'

interface UiState {
  // Application state
  isInitialized: boolean
  setIsInitialized: (value: boolean) => void

  // Theme state
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light' | 'dark'
  setResolvedTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void

  // Dashboard layout state
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  dashboardVariant: DashboardVariant
  setDashboardVariant: (variant: DashboardVariant) => void
  panelShadow: PanelShadow
  setPanelShadow: (shadow: PanelShadow) => void

  // Admin view modes (adjustable via initial state, not UI toggle)
  pluginsViewMode: AdminViewMode
  setPluginsViewMode: (mode: AdminViewMode) => void
  modelsViewMode: AdminViewMode
  setModelsViewMode: (mode: AdminViewMode) => void
  sourcesViewMode: AdminViewMode
  setSourcesViewMode: (mode: AdminViewMode) => void

  // Reset store
  reset: () => void
}

const initialState = {
  isInitialized: false,
  theme: 'system' as Theme,
  resolvedTheme: 'light' as 'light' | 'dark',
  layoutMode: 'fluid' as LayoutMode,
  dashboardVariant: 'gradient' as DashboardVariant,
  panelShadow: 'none' as PanelShadow,
  pluginsViewMode: 'table' as AdminViewMode,
  modelsViewMode: 'table' as AdminViewMode,
  sourcesViewMode: 'card' as AdminViewMode,
}

export const useUiStore = create<UiState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        // Application initialization
        setIsInitialized: (value) => set({ isInitialized: value }),

        // Theme management
        setTheme: (theme) => {
          let resolvedTheme: 'light' | 'dark' = 'light'
          if (theme === 'system') {
            resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)')
              .matches
              ? 'dark'
              : 'light'
          } else {
            resolvedTheme = theme
          }
          set({ theme, resolvedTheme })
        },
        setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
        toggleTheme: () =>
          set((state) => {
            const newTheme = state.resolvedTheme === 'light' ? 'dark' : 'light'
            return {
              theme: newTheme,
              resolvedTheme: newTheme,
            }
          }),

        // Dashboard layout management
        setLayoutMode: (layoutMode) => set({ layoutMode }),
        setDashboardVariant: (dashboardVariant) => set({ dashboardVariant }),
        setPanelShadow: (panelShadow) => set({ panelShadow }),

        // Admin view mode management
        setPluginsViewMode: (pluginsViewMode) => set({ pluginsViewMode }),
        setModelsViewMode: (modelsViewMode) => set({ modelsViewMode }),
        setSourcesViewMode: (sourcesViewMode) => set({ sourcesViewMode }),

        // Reset to initial state
        reset: () => set(initialState),
      }),
      {
        name: STORAGE_KEYS.stores.ui,
        version: STORE_VERSIONS.ui,
        onRehydrateStorage: () => (state) => {
          // Recalculate resolvedTheme after hydration based on persisted theme
          if (state) {
            const theme = state.theme
            let resolvedTheme: 'light' | 'dark' = 'light'
            if (theme === 'system') {
              resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)')
                .matches
                ? 'dark'
                : 'light'
            } else {
              resolvedTheme = theme
            }
            state.setResolvedTheme(resolvedTheme)
          }
        },
        migrate: (persistedState, version) => {
          const state = persistedState as Record<string, unknown>

          // Migration from v1 to v2: Add admin view modes
          if (version < 2) {
            state.pluginsViewMode = 'table'
            state.modelsViewMode = 'table'
          }

          // Migration from v2 to v3: Add sources view mode
          if (version < 3) {
            state.sourcesViewMode = 'table'
          }

          // Migration from v3 to v4: Remove sidebar state
          if (version < 4) {
            delete state.isSidebarOpen
          }

          return state as {
            theme: Theme
            layoutMode: LayoutMode
            dashboardVariant: DashboardVariant
            panelShadow: PanelShadow
            pluginsViewMode: AdminViewMode
            modelsViewMode: AdminViewMode
            sourcesViewMode: AdminViewMode
          }
        },
        partialize: (state) => ({
          theme: state.theme,
          layoutMode: state.layoutMode,
          dashboardVariant: state.dashboardVariant,
          panelShadow: state.panelShadow,
          pluginsViewMode: state.pluginsViewMode,
          modelsViewMode: state.modelsViewMode,
          sourcesViewMode: state.sourcesViewMode,
        }),
      },
    ),
    { name: 'UiStore' },
  ),
)
