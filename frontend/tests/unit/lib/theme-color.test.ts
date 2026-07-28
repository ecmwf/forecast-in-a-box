/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
// Raw source: browser-mode tests load no Tailwind, so the variable is not live.
import cssSource from '@/styles.css?raw'
import { THEME_COLOR } from '@/lib/theme-color'

/** Any CSS colour as [r,g,b], letting the browser do the conversion. */
function toRgb(color: string): Array<number> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
}

/** `--background` declared in the given selector's first block. */
function declaredBackground(selector: string): string {
  const block = cssSource.match(
    new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
  )
  return block?.[1].match(/--background:\s*([^;]+);/)?.[1].trim() ?? ''
}

describe('THEME_COLOR', () => {
  // The meta tag needs a literal, so these cannot reference the CSS variable —
  // this is what stops them drifting from it.
  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const)('matches --background in %s', (theme, selector) => {
    const declared = declaredBackground(selector)
    expect(declared).toMatch(/^oklch\(/)
    expect(toRgb(THEME_COLOR[theme])).toEqual(toRgb(declared))
  })

  it('matches the copy in theme-init.js, which cannot import it', async () => {
    const script = await fetch('/theme-init.js').then((r) => r.text())
    const literal = script.match(/COLOR = \{([^}]*)\}/)?.[1]
    expect(literal).toBeDefined()
    expect({
      light: literal!.match(/light:\s*'([^']+)'/)?.[1],
      dark: literal!.match(/dark:\s*'([^']+)'/)?.[1],
    }).toEqual({ light: THEME_COLOR.light, dark: THEME_COLOR.dark })
  })
})
