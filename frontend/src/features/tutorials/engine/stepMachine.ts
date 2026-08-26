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
 * Pure step policy for guided tours. Steps are a fixed sequence — a launch
 * always begins at step 1, and work already done presents as review.
 */

import type { AdvanceWhen, SearchRecord } from './types'

/** Already true at entry — never for next-click; `search` checks compare
 * the live search against itself, so only state-shaped ones pre-satisfy. */
export function isPreSatisfied(
  advance: AdvanceWhen,
  search: SearchRecord,
): boolean {
  switch (advance.kind) {
    case 'next-click':
      return false
    case 'search':
      return advance.check(search, search)
    case 'signal':
      return advance.check()
  }
}

/** 1-based position for the progress label. */
export function stepProgress(
  total: number,
  index: number,
): { current: number; total: number } {
  return {
    current: Math.max(1, Math.min(index, total - 1) + 1),
    total: Math.max(1, total),
  }
}
