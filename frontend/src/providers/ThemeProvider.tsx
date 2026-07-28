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
 * Theme Provider
 *
 * Manages application theming (light/dark mode, custom themes, etc.)
 * Currently a placeholder - can be extended to support theme switching.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { applyThemeColor } from '@/lib/theme-color'
import { useUiStore } from '@/stores/uiStore'

interface ThemeProviderProps {
  children: ReactNode
}

/**
 * Provider component for theme management
 * Applies theme class to document element based on store state
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useUiStore((state) => state.theme)
  const resolvedTheme = useUiStore((state) => state.resolvedTheme)
  const setResolvedTheme = useUiStore((state) => state.setResolvedTheme)

  // The store resolves 'system' once, so without this the app keeps the old
  // theme when the OS flips while it is open.
  useEffect(() => {
    if (theme !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setResolvedTheme(query.matches ? 'dark' : 'light')
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [theme, setResolvedTheme])

  useEffect(() => {
    // Apply theme to document root
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolvedTheme)
    // Tracks the explicit setting; a media attribute would see only the OS.
    applyThemeColor(resolvedTheme)
  }, [resolvedTheme])

  return <>{children}</>
}
