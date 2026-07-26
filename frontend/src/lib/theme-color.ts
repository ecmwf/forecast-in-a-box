/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Mirrors `--background`; duplicated in public/theme-init.js — change both. */
export const THEME_COLOR = {
  light: '#ffffff',
  dark: '#09090b',
} as const

/** Point the `theme-color` meta at `theme`; no-op when the tag is absent. */
export function applyThemeColor(theme: keyof typeof THEME_COLOR): void {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme])
}
