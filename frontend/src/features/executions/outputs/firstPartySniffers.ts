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
 * First-party sniffers for the recurring backend mislabel where raw bytes
 * are tagged as `application/pickle` or `application/octet-stream` regardless
 * of actual content (cascade's wire encoder fallback). Detects PNG and PDF
 * by magic bytes and promotes to the correct mime for adapter dispatch.
 */

import { registerSniffer } from './sniffers'

const KNOWN_OPAQUE_MIMES = [
  'application/pickle',
  'application/clpkl',
  'application/octet-stream',
] as const

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

function startsWith(head: Uint8Array, magic: ReadonlyArray<number>): boolean {
  if (head.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic[i]) return false
  }
  return true
}

/** SVG bytes start as text — either an XML prolog (`<?xml`) or directly with
 * an `<svg` tag, optionally preceded by BOM / whitespace. Decode the head as
 * UTF-8 and look for the marker. */
function looksLikeSvg(head: Uint8Array): boolean {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(head)
  } catch {
    return false
  }
  // Strip BOM (U+FEFF) + leading whitespace before checking the prefix.
  const stripped = text.replace(/^[\uFEFF]?\s*/, '').toLowerCase()
  return stripped.startsWith('<?xml') || stripped.startsWith('<svg')
}

let registered = false

export function registerFirstPartySniffers(): void {
  if (registered) return
  registered = true

  registerSniffer({
    candidateMimes: KNOWN_OPAQUE_MIMES,
    bytesNeeded: 8,
    detect: (head) => (startsWith(head, PNG_MAGIC) ? 'image/png' : null),
  })

  registerSniffer({
    candidateMimes: KNOWN_OPAQUE_MIMES,
    bytesNeeded: 5,
    detect: (head) => (startsWith(head, PDF_MAGIC) ? 'application/pdf' : null),
  })

  registerSniffer({
    candidateMimes: KNOWN_OPAQUE_MIMES,
    bytesNeeded: 64,
    detect: (head) => (looksLikeSvg(head) ? 'image/svg+xml' : null),
  })
}
