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
 * Comparison basket — the persisted list of sources a user has collected
 * for the /compare page. Identity is the entry ref (see entry-ref.ts);
 * which two entries are ACTIVE (slots A/B) lives in the /compare URL, not
 * here, so a comparison link stays shareable while the basket is local.
 *
 * Actions are pure state transitions: no toasts here — callers translate
 * the returned AddEntryResult into user feedback.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { entryRef } from '../entry-ref'
import type { ComparisonEntry, NewComparisonEntry } from '../entry-ref'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

export const MAX_COMPARISON_ENTRIES = 8

export type AddEntryResult = 'added' | 'duplicate' | 'full'

interface ComparisonState {
  entries: Array<ComparisonEntry>
  addEntry: (entry: NewComparisonEntry) => AddEntryResult
  removeEntry: (ref: string) => void
  /** Fill in lazily-resolved display metadata for an `output` entry. */
  updateOutputMeta: (
    ref: string,
    meta: Partial<{
      runName: string
      blockTitle: string
      runCreatedAt: string | null
    }>,
  ) => void
  /** Rename a `path`/`wms` entry (labels are user-editable). */
  renameEntry: (ref: string, label: string) => void
  clear: () => void
}

export const useComparisonStore = create<ComparisonState>()(
  devtools(
    persist(
      (set, get) => ({
        entries: [],

        addEntry: (entry) => {
          const ref = entryRef(entry)
          const { entries } = get()
          if (entries.some((e) => entryRef(e) === ref)) return 'duplicate'
          if (entries.length >= MAX_COMPARISON_ENTRIES) return 'full'
          set(
            { entries: [...entries, { ...entry, addedAt: Date.now() }] },
            undefined,
            'compare/addEntry',
          )
          return 'added'
        },

        removeEntry: (ref) =>
          set(
            (state) => ({
              entries: state.entries.filter((e) => entryRef(e) !== ref),
            }),
            undefined,
            'compare/removeEntry',
          ),

        updateOutputMeta: (ref, meta) =>
          set(
            (state) => {
              const idx = state.entries.findIndex(
                (e) => e.kind === 'output' && entryRef(e) === ref,
              )
              if (idx < 0) return state
              const current = state.entries[idx]
              // Only write when a value actually changes — enrichment runs
              // per render cycle and must not loop the store.
              const next = { ...current, ...meta } as ComparisonEntry
              if (JSON.stringify(next) === JSON.stringify(current)) {
                return state
              }
              const entries = [...state.entries]
              entries[idx] = next
              return { entries }
            },
            undefined,
            'compare/updateOutputMeta',
          ),

        renameEntry: (ref, label) =>
          set(
            (state) => ({
              entries: state.entries.map((e) =>
                (e.kind === 'path' || e.kind === 'wms') && entryRef(e) === ref
                  ? { ...e, label }
                  : e,
              ),
            }),
            undefined,
            'compare/renameEntry',
          ),

        clear: () => set({ entries: [] }, undefined, 'compare/clear'),
      }),
      {
        name: STORAGE_KEYS.stores.comparison,
        version: STORE_VERSIONS.comparison,
        partialize: (state) => ({ entries: state.entries }),
      },
    ),
    { name: 'ComparisonStore' },
  ),
)

// -------- Primitive selectors (no re-render storms) --------

export function useComparisonCount(): number {
  return useComparisonStore((s) => s.entries.length)
}

export function useIsInComparison(ref: string): boolean {
  return useComparisonStore((s) => s.entries.some((e) => entryRef(e) === ref))
}
