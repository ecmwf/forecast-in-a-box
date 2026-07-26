/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Exercises the shipped public/theme-init.js, not a copy of its logic. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const realMatchMedia = window.matchMedia
let run = 0

/** Load the script the way the document does, against a stubbed OS preference. */
function runWithOsDark(osDark: boolean): Promise<void> {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('dark') ? osDark : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    // Fresh URL each time so the browser re-executes rather than dedupes.
    script.src = `/theme-init.js?run=${(run += 1)}`
    script.onload = () => {
      script.remove()
      resolve()
    }
    script.onerror = () => reject(new Error('theme-init.js failed to load'))
    document.head.appendChild(script)
  })
}

function storeTheme(theme: string) {
  localStorage.setItem(
    STORAGE_KEYS.stores.ui,
    JSON.stringify({ state: { theme }, version: 1 }),
  )
}

const themeColor = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

describe('theme-init', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.stores.ui)
    document.documentElement.classList.remove('light', 'dark')
    document.querySelector('meta[name="theme-color"]')?.remove()
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
    localStorage.removeItem(STORAGE_KEYS.stores.ui)
    document.documentElement.classList.remove('light', 'dark')
    document.querySelector('meta[name="theme-color"]')?.remove()
  })

  it('honours an explicit choice over a contradicting OS preference', async () => {
    // Why a script and not a media query: the latter sees only the OS.
    storeTheme('light')
    await runWithOsDark(true)

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(themeColor()).toBe('#ffffff')
  })

  it('applies an explicit dark choice under a light OS', async () => {
    storeTheme('dark')
    await runWithOsDark(false)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(themeColor()).toBe('#09090b')
  })

  it('follows the OS when the choice is system', async () => {
    storeTheme('system')
    await runWithOsDark(true)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('falls back to the OS with nothing stored', async () => {
    await runWithOsDark(true)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('falls back to the OS when storage is malformed', async () => {
    localStorage.setItem(STORAGE_KEYS.stores.ui, 'not-json')
    await runWithOsDark(true)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('ignores an unknown persisted theme', async () => {
    storeTheme('solarized')
    await runWithOsDark(false)

    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})
