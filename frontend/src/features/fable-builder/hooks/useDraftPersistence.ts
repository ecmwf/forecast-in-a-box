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

const DRAFTS_KEY = STORAGE_KEYS.fable.drafts
const LEGACY_DRAFT_KEY = STORAGE_KEYS.fable.draft
const DEBOUNCE_MS = 2000
const MAX_DRAFTS = 5
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000 // a week

export interface FableDraft {
  fable: FableBuilderV1
  fableId: string | null
  /** Template lineage — a restored fork keeps create-on-save semantics. */
  forkParentId: string | null
  fableName: string
  fableVersion: number | null
  savedAt: number // Date.now() when the draft was written
}

type DraftMap = Record<string, FableDraft>

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

/** One draft slot per editing target, so sessions never overwrite each other. */
export function draftTargetFor({
  fableId,
  forkParentId,
}: {
  fableId?: string | null
  forkParentId?: string | null
}): string {
  if (fableId) return `id:${fableId}`
  if (forkParentId) return `template:${forkParentId}`
  return 'new'
}

function readDraftMap(): DraftMap {
  const map = readStorageJson<DraftMap>(DRAFTS_KEY)
  if (map) return map
  // One-shot migration of the pre-slot single-draft format.
  const legacy = readStorageJson<FableDraft>(LEGACY_DRAFT_KEY)
  if (!legacy) return {}
  removeStorage(LEGACY_DRAFT_KEY)
  const migrated = {
    [draftTargetFor(legacy)]: {
      ...legacy,
      forkParentId: legacy.forkParentId ?? null,
    },
  }
  writeStorageJson(DRAFTS_KEY, migrated)
  return migrated
}

/** Stale slots die; beyond the count cap the oldest go first. */
function prune(map: DraftMap): DraftMap {
  const now = Date.now()
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, draft]) => now - draft.savedAt <= MAX_DRAFT_AGE_MS)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_DRAFTS),
  )
}

export function readDraft(target: string): FableDraft | null {
  const draft = readDraftMap()[target] as FableDraft | undefined
  if (!draft || Date.now() - draft.savedAt > MAX_DRAFT_AGE_MS) return null
  return draft
}

export function clearDraft(target: string): void {
  const map = readDraftMap()
  if (!(target in map)) return
  delete map[target]
  writeStorageJson(DRAFTS_KEY, map)
}

// Save-time clearing must hit the slot the session was written under —
// markSaved changes the store identity before the subscriber runs.
let lastWrittenTarget: string | null = null

/** Write the store's unsaved work into its target slot now (no-op when clean). */
export function flushDraft(): void {
  const { fable, fableId, forkParentId, fableName, fableVersion, isDirty } =
    useFableBuilderStore.getState()
  try {
    if (isDirty) {
      const target = draftTargetFor({ fableId, forkParentId })
      lastWrittenTarget = target
      const map = readDraftMap()
      map[target] = {
        fable,
        fableId,
        forkParentId,
        fableName,
        fableVersion,
        savedAt: Date.now(),
      }
      writeStorageJson(DRAFTS_KEY, prune(map))
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
        // A save supersedes the session's slot — clear it immediately.
        if (selected.lastSavedAt !== prevSelected.lastSavedAt) {
          const { fableId, forkParentId } = useFableBuilderStore.getState()
          clearDraft(draftTargetFor({ fableId, forkParentId }))
          if (lastWrittenTarget) {
            clearDraft(lastWrittenTarget)
            lastWrittenTarget = null
          }
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
