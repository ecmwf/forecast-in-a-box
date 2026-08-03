/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useRef } from 'react'
import { readStorageJson, writeStorageJson } from '@/lib/storage'

/** Pane share in percent, keyed by pane id (sums to ~100). */
export type SplitLayout = Record<string, number>

/** Persisted split-pane layout: restored on mount, saved on every resize. */
export function useSplitLayout(storageKey: string): {
  defaultLayout: SplitLayout | undefined
  onLayoutChanged: (layout: SplitLayout) => void
} {
  const initialRef = useRef<SplitLayout | null | undefined>(undefined)
  initialRef.current ??= readStorageJson<SplitLayout>(storageKey)

  const onLayoutChanged = useCallback(
    (layout: SplitLayout) => {
      writeStorageJson(storageKey, layout)
    },
    [storageKey],
  )

  return {
    defaultLayout: initialRef.current ?? undefined,
    onLayoutChanged,
  }
}
