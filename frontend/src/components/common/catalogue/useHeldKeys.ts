/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'

/** Keys busy since `resetKey` changed: they stay listed until re-filtering. */
export function useHeldKeys(
  busyKeys: ReadonlyArray<string>,
  resetKey: string,
): ReadonlySet<string> {
  const [held, setHeld] = useState(() => ({
    resetKey,
    keys: new Set(busyKeys),
  }))

  let next = held
  if (next.resetKey !== resetKey) next = { resetKey, keys: new Set() }
  const added = busyKeys.filter((key) => !next.keys.has(key))
  if (added.length > 0) {
    next = { resetKey, keys: new Set([...next.keys, ...added]) }
  }
  if (next !== held) setHeld(next)

  return next.keys
}
