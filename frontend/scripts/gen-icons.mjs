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
 * Regenerates every app icon from public/logos/fiab-mark.svg.
 *
 * Run after changing the mark:  node scripts/gen-icons.mjs
 * Requires ImageMagick 7 (`brew install imagemagick`).
 *
 * The tab icon is the bare mark. The rest sit on a brand tile with the mark
 * knocked out in white, because iOS composites transparent touch icons onto
 * black and Android crops maskable ones to a circle needing full-bleed colour.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BRAND = '#006197'
const SRC = 'public/logos/fiab-mark.svg'
const OUT = 'public/'

// Share of the tile the mark spans. Maskable gets less: Android crops to a
// circle inscribed in the central 80%, so content must clear that.
const INSET = { tile: 0.68, maskable: 0.55 }

const tmp = mkdtempSync(join(tmpdir(), 'fiab-icons-'))
const magick = (...args) => execFileSync('magick', args.map(String))

/** The mark rendered white at `px` tall, alpha preserved. */
function whiteMark(px) {
  const out = join(tmp, `mark-${px}.png`)
  magick(
    '-background',
    'none',
    '-density',
    '1200',
    SRC,
    '-resize',
    `x${px}`,
    '-fill',
    'white',
    '-colorize',
    '100%',
    out,
  )
  return out
}

/** The mark on transparency, brand blue, filling `size` — for the tab icon. */
function plainIcon(size, out) {
  magick(
    '-background',
    'none',
    '-density',
    '1200',
    SRC,
    '-resize',
    `${size}x${size}`,
    '-gravity',
    'center',
    '-extent',
    `${size}x${size}`,
    out,
  )
  return out
}

/** Brand tile with the mark centred; `radius` 0 gives the square iOS wants. */
function tileIcon(size, out, { radius = 0.22, inset = INSET.tile } = {}) {
  const bg = join(tmp, `bg-${size}-${radius}.png`)
  if (radius > 0) {
    const r = Math.round(size * radius)
    magick(
      '-size',
      `${size}x${size}`,
      'xc:none',
      '-fill',
      BRAND,
      '-draw',
      `roundrectangle 0,0,${size - 1},${size - 1},${r},${r}`,
      bg,
    )
  } else {
    magick('-size', `${size}x${size}`, `xc:${BRAND}`, bg)
  }
  magick(
    bg,
    whiteMark(Math.round(size * inset)),
    '-gravity',
    'center',
    '-composite',
    out,
  )
  return out
}

/**
 * Transparent SVG favicon, tracking the browser theme.
 *
 * Kept plate-free so it matches the header lockup, which the tile rasters
 * cannot: brand blue scores 1.8:1 on a dark tab strip, so dark mode swaps to
 * white. Only the SVG can do this — a raster .ico is fixed, hence the tile.
 */
function markSvg(out) {
  const src = readFileSync(SRC, 'utf8')
  const [, vb] = src.match(/viewBox="([^"]+)"/)
  const inner = src
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
  writeFileSync(
    out,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">` +
      // After the source's own rule, so it wins on equal specificity.
      `${inner}<style>@media(prefers-color-scheme:dark){.cls-1{fill:#fff}}</style>` +
      `</svg>\n`,
  )
}

try {
  // Tab icon is the bare mark, matching the header lockup; the plated
  // variants below exist only where the platform demands opacity.
  const ico = [16, 32, 48].map((s) => plainIcon(s, join(tmp, `ico-${s}.png`)))
  magick(...ico, `${OUT}favicon.ico`)

  tileIcon(192, `${OUT}icon-192.png`)
  tileIcon(512, `${OUT}icon-512.png`)
  tileIcon(512, `${OUT}icon-512-maskable.png`, {
    radius: 0,
    inset: INSET.maskable,
  })
  tileIcon(180, `${OUT}apple-touch-icon.png`, { radius: 0 })
  markSvg(`${OUT}icon.svg`)

  console.log('icons written to public/')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
