/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import {
  clearDraft,
  draftTargetFor,
  flushDraft,
  readDraft,
  useDraftPersistence,
} from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const DRAFTS_KEY = 'fiab.fable.drafts'
const LEGACY_KEY = 'fiab.fable.draft'

function makeDraft(overrides: Partial<FableDraft> = {}): FableDraft {
  return {
    fable: {
      blocks: {
        block_1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'base' },
            factory: 'operationalForecastSource',
          },
          configuration_values: { source: 'ecmwf-open-data' },
          input_ids: {},
        },
      },
    },
    fableId: null,
    forkParentId: null,
    fableName: 'Test Config',
    fableVersion: null,
    savedAt: Date.now(),
    ...overrides,
  }
}

function seedDrafts(map: Record<string, FableDraft>): void {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(map))
}

describe('useDraftPersistence helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => useFableBuilderStore.getState().reset())
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('draftTargetFor', () => {
    it('derives one slot per editing target', () => {
      expect(draftTargetFor({ fableId: 'bp-1' })).toBe('id:bp-1')
      expect(draftTargetFor({ forkParentId: 'tpl-1' })).toBe('template:tpl-1')
      expect(draftTargetFor({})).toBe('new')
    })

    it('an own identity wins over template lineage', () => {
      expect(draftTargetFor({ fableId: 'bp-1', forkParentId: 'tpl-1' })).toBe(
        'id:bp-1',
      )
    })
  })

  describe('readDraft', () => {
    it('returns null when no draft exists', () => {
      expect(readDraft('new')).toBeNull()
    })

    it('reads only its own slot', () => {
      const mine = makeDraft({ fableId: 'bp-1', fableName: 'Mine' })
      seedDrafts({ new: makeDraft(), 'id:bp-1': mine })

      expect(readDraft('id:bp-1')).toEqual(mine)
      expect(readDraft('new')?.fableName).toBe('Test Config')
    })

    it('returns null for malformed JSON', () => {
      localStorage.setItem(DRAFTS_KEY, 'not-json')
      expect(readDraft('new')).toBeNull()
    })

    it('returns null for a slot past the age cap', () => {
      seedDrafts({
        new: makeDraft({ savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }),
      })
      expect(readDraft('new')).toBeNull()
    })

    it('migrates the legacy single-slot draft', () => {
      const { forkParentId: _omit, ...legacy } = makeDraft({
        fableId: 'bp-9',
        fableName: 'Old format',
      })
      localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy))

      const migrated = readDraft('id:bp-9')
      expect(migrated?.fableName).toBe('Old format')
      expect(migrated?.forkParentId).toBeNull()
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    })
  })

  describe('clearDraft', () => {
    it('removes only the given slot', () => {
      seedDrafts({
        new: makeDraft(),
        'id:bp-1': makeDraft({ fableId: 'bp-1' }),
      })

      clearDraft('new')

      expect(readDraft('new')).toBeNull()
      expect(readDraft('id:bp-1')).not.toBeNull()
    })

    it('does not throw when no draft exists', () => {
      expect(() => clearDraft('new')).not.toThrow()
    })
  })

  describe('flushDraft', () => {
    it('writes the dirty store into its target slot', () => {
      act(() =>
        useFableBuilderStore.setState({
          fable: makeDraft().fable,
          fableId: 'bp-1',
          fableName: 'Flushed',
          isDirty: true,
          draftWritePending: true,
        }),
      )

      flushDraft()

      expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
      expect(readDraft('id:bp-1')?.fableName).toBe('Flushed')
      expect(readDraft('new')).toBeNull()
    })

    it('a template fork writes into its template slot with lineage', () => {
      act(() =>
        useFableBuilderStore.setState({
          fable: makeDraft().fable,
          forkParentId: 'tpl-1',
          isDirty: true,
        }),
      )

      flushDraft()

      expect(readDraft('template:tpl-1')?.forkParentId).toBe('tpl-1')
    })

    it('does not write when the store is clean', () => {
      flushDraft()
      expect(readDraft('new')).toBeNull()
    })

    it('leaves other slots untouched', () => {
      seedDrafts({ 'id:other': makeDraft({ fableId: 'other' }) })
      act(() =>
        useFableBuilderStore.setState({
          fable: makeDraft().fable,
          isDirty: true,
        }),
      )

      flushDraft()

      expect(readDraft('new')).not.toBeNull()
      expect(readDraft('id:other')).not.toBeNull()
    })

    it('prunes the oldest slots beyond the count cap', () => {
      const base = Date.now()
      seedDrafts(
        Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((id, index) => [
            `id:${id}`,
            makeDraft({ fableId: id, savedAt: base - (index + 1) * 1000 }),
          ]),
        ),
      )
      act(() =>
        useFableBuilderStore.setState({
          fable: makeDraft().fable,
          isDirty: true,
        }),
      )

      flushDraft()

      const stored = JSON.parse(localStorage.getItem(DRAFTS_KEY)!) as object
      expect(Object.keys(stored)).toHaveLength(5)
      expect(readDraft('new')).not.toBeNull()
      expect(readDraft('id:e')).toBeNull()
    })
  })
})

describe('useDraftPersistence hook', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    act(() => useFableBuilderStore.getState().newFable())
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('writes the draft and clears the saving flag after the debounce', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(useFableBuilderStore.getState().draftWritePending).toBe(true)

    act(() => vi.advanceTimersByTime(2000))

    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft('new')).not.toBeNull()
  })

  it('clears the written slot on save even though the identity changed', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    act(() => vi.advanceTimersByTime(2000))
    expect(readDraft('new')).not.toBeNull()

    // markSaved re-points fableId before the subscriber runs.
    act(() => useFableBuilderStore.getState().markSaved('bp-9', 1))

    expect(readDraft('new')).toBeNull()
  })

  it('flushes the draft on pagehide (tab close never unmounts)', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(readDraft('new')).toBeNull()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft('new')).not.toBeNull()
  })

  it('flushes the draft when the document becomes hidden', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(readDraft('new')).toBeNull()

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }

    expect(readDraft('new')).not.toBeNull()
  })

  it('writes the draft on unmount even without a pending debounce', () => {
    const { unmount } = renderHook(() => useDraftPersistence())

    // Mimic a restore: fable set clean, dirty flagged after — no debounce runs.
    act(() => useFableBuilderStore.setState({ fable: makeDraft().fable }))
    act(() => useFableBuilderStore.setState({ isDirty: true }))
    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft('new')).toBeNull()

    act(() => unmount())

    expect(readDraft('new')).not.toBeNull()
  })

  it('flushes the draft and clears the saving flag when unmounted mid-debounce', () => {
    const { unmount } = renderHook(() => useDraftPersistence())

    // A dirty edit schedules a debounced write and shows "Saving…".
    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(useFableBuilderStore.getState().draftWritePending).toBe(true)
    expect(readDraft('new')).toBeNull()

    // Navigating away mid-debounce must not strand the flag or lose the draft.
    act(() => unmount())

    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft('new')).not.toBeNull()
  })
})
