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
 * Applies the theme before first paint; ThemeProvider only does so after
 * hydration. External, not inline, because the CSP allows only 'self'.
 * Colours mirror THEME_COLOR in src/lib/theme-color.ts — change both.
 */
;(function () {
  const COLOR = { light: '#ffffff', dark: '#09090b' }
  let theme = 'system'

  try {
    // zustand persist wraps the store as { state, version }.
    const raw = localStorage.getItem('fiab.store.ui')
    const stored = raw && JSON.parse(raw).state.theme
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      theme = stored
    }
  } catch {
    // Malformed storage: fall back to the system preference.
  }

  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolved = dark ? 'dark' : 'light'

  document.documentElement.classList.add(resolved)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', COLOR[resolved])
})()
