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
 * Auto-persists fable drafts to localStorage so users don't lose unsaved
 * work on accidental navigation or tab close.
 *
 * - Writes debounced (2 s) after every store change that sets isDirty.
 * - Clears the draft on successful save (markSaved).
 * - On mount, restoration is handled by FableBuilderPage via readDraft().
 *
 * No `beforeunload` guard — the localStorage draft is the safety net, and
 * the header already shows an "Unsaved" badge when the state is dirty. The
 * native "Leave site?" prompt is intrusive and inconsistent with modern
 * autosave UX (Figma / Google Docs / Airtable).
 */

import { useEffect, useRef } from 'react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { readStorageJson, removeStorage, writeStorageJson } from '@/lib/storage'

const DRAFT_KEY = STORAGE_KEYS.fable.draft
const DEBOUNCE_MS = 2000

export interface FableDraft {
  fable: FableBuilderV1
  fableId: string | null
  fableName: string
  fableVersion: number | null
  savedAt: number // Date.now() when the draft was written
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function writeDraft(draft: FableDraft): void {
  writeStorageJson(DRAFT_KEY, draft)
}

export function readDraft(): FableDraft | null {
  return readStorageJson<FableDraft>(DRAFT_KEY)
}

export function clearDraft(): void {
  removeStorage(DRAFT_KEY)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDraftPersistence(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced write: subscribe only to the draft-relevant slices so the
  // listener doesn't run on every unrelated UI state change (panels, mode, …).
  useEffect(() => {
    // Write the unsaved draft and clear the "saving" flag — shared by the
    // debounce timer and the unmount flush. `finally` keeps it from sticking.
    function flush(): void {
      const { fable, fableId, fableName, fableVersion, isDirty } =
        useFableBuilderStore.getState()
      try {
        if (isDirty) {
          writeDraft({
            fable,
            fableId,
            fableName,
            fableVersion,
            savedAt: Date.now(),
          })
        }
      } finally {
        useFableBuilderStore.setState({ draftWritePending: false })
      }
    }

    const unsub = useFableBuilderStore.subscribe(
      (state) => ({
        fable: state.fable,
        fableName: state.fableName,
        isDirty: state.isDirty,
        lastSavedAt: state.lastSavedAt,
      }),
      (selected, prevSelected) => {
        // Clear draft immediately on save
        if (selected.lastSavedAt !== prevSelected.lastSavedAt) {
          clearDraft()
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
          useFableBuilderStore.setState({ draftWritePending: false })
          return
        }

        // Only persist when dirty and fable data actually changed
        if (!selected.isDirty) return
        if (
          selected.fable === prevSelected.fable &&
          selected.fableName === prevSelected.fableName
        )
          return

        if (timerRef.current) clearTimeout(timerRef.current)
        useFableBuilderStore.setState({ draftWritePending: true })
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          flush()
        }, DEBOUNCE_MS)
      },
      {
        equalityFn: (a, b) =>
          a.fable === b.fable &&
          a.fableName === b.fableName &&
          a.isDirty === b.isDirty &&
          a.lastSavedAt === b.lastSavedAt,
      },
    )

    return () => {
      unsub()
      // Flush a pending write on unmount (navigating away mid-debounce): the
      // store outlives the route, so otherwise the draft is lost and "Saving…"
      // sticks.
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        flush()
      }
    }
  }, [])
}
