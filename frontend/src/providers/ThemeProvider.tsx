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
import { useUiStore } from '@/stores/uiStore'

interface ThemeProviderProps {
  children: ReactNode
}

/**
 * Provider component for theme management
 * Applies theme class to document element based on store state
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useUiStore((state) => state.resolvedTheme)

  useEffect(() => {
    // Apply theme to document root
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  return <>{children}</>
}
