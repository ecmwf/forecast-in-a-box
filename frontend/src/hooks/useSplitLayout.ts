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
import type { RefObject } from 'react'
import type { Layout } from 'react-resizable-panels'
import { readStorageJson, writeStorageJson } from '@/lib/storage'

/** Persisted split-pane layout: restored on mount, saved on every resize. */
export function useSplitLayout(storageKey: string): {
  defaultLayout: Layout | undefined
  onLayoutChanged: (layout: Layout) => void
  /** Latest applied layout — nudge handlers derive the next one from it. */
  layoutRef: RefObject<Layout | null>
} {
  const initialRef = useRef<Layout | null | undefined>(undefined)
  initialRef.current ??= readStorageJson<Layout>(storageKey)
  const layoutRef = useRef<Layout | null>(initialRef.current)

  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      layoutRef.current = layout
      writeStorageJson(storageKey, layout)
    },
    [storageKey],
  )

  return {
    defaultLayout: initialRef.current ?? undefined,
    onLayoutChanged,
    layoutRef,
  }
}
