/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One set-aside configuration slot (write-through to localStorage) —
 *  replaced dirty bench work parks here; the builder banner resolves it. */

import { create } from 'zustand'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import {
  clearDraft,
  readDraft,
} from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { readStorageJson, removeStorage, writeStorageJson } from '@/lib/storage'

const SHELF_KEY = STORAGE_KEYS.fable.shelf

interface WorkbenchShelfState {
  shelf: FableDraft | null
  shelve: (snapshot: FableDraft) => void
  clear: () => void
}

export const useWorkbenchShelfStore = create<WorkbenchShelfState>()((set) => ({
  shelf: readStorageJson<FableDraft>(SHELF_KEY),
  shelve: (snapshot) => {
    writeStorageJson(SHELF_KEY, snapshot)
    set({ shelf: snapshot })
  },
  clear: () => {
    removeStorage(SHELF_KEY)
    set({ shelf: null })
  },
}))

/** Snapshot of the live bench in the draft shape. */
export function benchSnapshot(): FableDraft {
  const state = useFableBuilderStore.getState()
  return {
    fable: state.fable,
    fableId: state.fableId,
    forkParentId: state.forkParentId,
    fableName: state.fableName,
    fableVersion: state.fableVersion,
    savedAt: Date.now(),
  }
}

export interface ShelveResult {
  /** What was parked; null when there was nothing worth keeping. */
  shelved: FableDraft | null
  /** Non-null when parking replaced an earlier set-aside configuration. */
  evicted: FableDraft | null
}

/** Park unsaved bench work (live canvas, or the cold-mount draft) before an
 *  incoming config lands; `incoming` skips payloads identical to the bench. */
export function shelveBenchIfDirty(
  incoming: FableBuilderV1 | null = null,
): ShelveResult {
  const state = useFableBuilderStore.getState()
  let snapshot: FableDraft | null = null
  if (Object.keys(state.fable.blocks).length > 0) {
    if (state.isDirty) snapshot = benchSnapshot()
  } else {
    const draft = readDraft()
    if (draft && Object.keys(draft.fable.blocks).length > 0) snapshot = draft
  }
  if (
    !snapshot ||
    (incoming && JSON.stringify(snapshot.fable) === JSON.stringify(incoming))
  ) {
    return { shelved: null, evicted: null }
  }

  const evicted = useWorkbenchShelfStore.getState().shelf
  useWorkbenchShelfStore.getState().shelve(snapshot)
  // A pending draft flush must not re-bank what now lives on the shelf.
  clearDraft()
  useFableBuilderStore.setState({ isDirty: false })
  return { shelved: snapshot, evicted }
}
