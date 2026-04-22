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

const DRAFT_KEY = 'fiab.fable.draft'
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
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // localStorage full or unavailable — silently drop
  }
}

export function readDraft(): FableDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as FableDraft
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDraftPersistence(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced write: subscribe to store changes
  useEffect(() => {
    const unsub = useFableBuilderStore.subscribe((state, prevState) => {
      // Clear draft immediately on save
      if (state.lastSavedAt !== prevState.lastSavedAt) {
        clearDraft()
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        useFableBuilderStore.setState({ draftWritePending: false })
        return
      }

      // Only persist when dirty and fable data actually changed
      if (!state.isDirty) return
      if (
        state.fable === prevState.fable &&
        state.fableName === prevState.fableName
      )
        return

      if (timerRef.current) clearTimeout(timerRef.current)
      useFableBuilderStore.setState({ draftWritePending: true })
      timerRef.current = setTimeout(() => {
        writeDraft({
          fable: state.fable,
          fableId: state.fableId,
          fableName: state.fableName,
          fableVersion: state.fableVersion,
          savedAt: Date.now(),
        })
        timerRef.current = null
        useFableBuilderStore.setState({ draftWritePending: false })
      }, DEBOUNCE_MS)
    })

    return () => {
      unsub()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
