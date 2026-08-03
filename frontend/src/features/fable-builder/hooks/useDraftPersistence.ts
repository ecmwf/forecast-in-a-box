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
 * Persists the workbench — the single work-in-progress — to localStorage so
 * it survives navigation, tab close, and reload.
 *
 * - Writes debounced (2 s) after every store change that sets isDirty.
 * - Clears the slot on successful save (markSaved).
 * - On mount, FableBuilderPage restores it silently via readDraft().
 *
 * No `beforeunload` prompt — the slot is the safety net; prompts belong to
 * the moment work would be replaced, not to leaving the page.
 */

import { useEffect, useRef } from 'react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { readStorageJson, removeStorage, writeStorageJson } from '@/lib/storage'

const DRAFT_KEY = STORAGE_KEYS.fable.draft
const LEGACY_MAP_KEY = STORAGE_KEYS.fable.drafts
const DEBOUNCE_MS = 2000

export interface FableDraft {
  fable: FableBuilderV1
  fableId: string | null
  /** Template lineage — a restored fork keeps create-on-save semantics. */
  forkParentId: string | null
  fableName: string
  fableVersion: number | null
  savedAt: number // Date.now() when the draft was written
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

/** The workbench slot — the one work-in-progress, nothing else. */
export function readDraft(): FableDraft | null {
  const draft = readStorageJson<FableDraft>(DRAFT_KEY)
  if (draft) return { ...draft, forkParentId: draft.forkParentId ?? null }
  // One-shot migration of the interim per-target map: newest content wins.
  const map = readStorageJson<Record<string, FableDraft>>(LEGACY_MAP_KEY)
  if (!map) return null
  removeStorage(LEGACY_MAP_KEY)
  const newest = Object.values(map)
    .filter((entry) => Object.keys(entry.fable.blocks).length > 0)
    .sort((a, b) => b.savedAt - a.savedAt)
    .at(0)
  if (!newest) return null
  const migrated = { ...newest, forkParentId: newest.forkParentId ?? null }
  writeStorageJson(DRAFT_KEY, migrated)
  return migrated
}

export function clearDraft(): void {
  removeStorage(DRAFT_KEY)
}

/** Write the store's unsaved work as the workbench now (no-op when clean). */
export function flushDraft(): void {
  const { fable, fableId, forkParentId, fableName, fableVersion, isDirty } =
    useFableBuilderStore.getState()
  try {
    if (isDirty) {
      writeStorageJson(DRAFT_KEY, {
        fable,
        fableId,
        forkParentId,
        fableName,
        fableVersion,
        savedAt: Date.now(),
      })
    }
  } finally {
    useFableBuilderStore.setState({ draftWritePending: false })
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDraftPersistence(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced write: subscribe only to the draft-relevant slices so the
  // listener doesn't run on every unrelated UI state change (panels, mode, …).
  useEffect(() => {
    const unsub = useFableBuilderStore.subscribe(
      (state) => ({
        fable: state.fable,
        fableName: state.fableName,
        isDirty: state.isDirty,
        lastSavedAt: state.lastSavedAt,
      }),
      (selected, prevSelected) => {
        // A save supersedes the workbench slot — clear it immediately.
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
          flushDraft()
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

    // Tab close/hide never unmounts — flush there too, mid-debounce included.
    const flushNow = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      flushDraft()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsub()
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // A restored-but-unedited session has no timer yet must survive cold boot.
      flushNow()
    }
  }, [])
}
