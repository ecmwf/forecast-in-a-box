/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { Sniffer } from './types'

const sniffers: Array<Sniffer> = []

export function registerSniffer(sniffer: Sniffer): void {
  sniffers.push(sniffer)
}

/**
 * Run sniffers for the given mime against the head bytes. Returns the first
 * non-null promotion, or null. Caller is responsible for fetching enough
 * bytes for `Math.max(...sniffer.bytesNeeded)`.
 */
export function runSniffers(mime: string, head: Uint8Array): string | null {
  for (const s of sniffers) {
    if (!s.candidateMimes.includes(mime)) continue
    const promoted = s.detect(head.subarray(0, s.bytesNeeded))
    if (promoted !== null) return promoted
  }
  return null
}

/** Cheap synchronous test: is there at least one registered sniffer that
 * could possibly promote this mime? Used by the resolver to decide whether
 * fetching bytes is worthwhile. */
export function hasSnifferFor(mime: string): boolean {
  return sniffers.some((s) => s.candidateMimes.includes(mime))
}

/** Largest `bytesNeeded` across registered sniffers. */
export function maxSnifferBytes(): number {
  let max = 0
  for (const s of sniffers) {
    if (s.bytesNeeded > max) max = s.bytesNeeded
  }
  return max
}
