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
  flushDraft,
  readDraft,
  useDraftPersistence,
} from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const DRAFT_KEY = 'fiab.fable.draft'
const LEGACY_MAP_KEY = 'fiab.fable.drafts'

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

describe('useDraftPersistence helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => useFableBuilderStore.getState().reset())
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('readDraft', () => {
    it('returns null when no draft exists', () => {
      expect(readDraft()).toBeNull()
    })

    it('reads the workbench slot', () => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(makeDraft()))
      expect(readDraft()?.fableName).toBe('Test Config')
    })

    it('returns null for malformed JSON', () => {
      localStorage.setItem(DRAFT_KEY, 'not-json')
      expect(readDraft()).toBeNull()
    })

    it('normalises a pre-fork draft without forkParentId', () => {
      const { forkParentId: _omit, ...legacy } = makeDraft()
      localStorage.setItem(DRAFT_KEY, JSON.stringify(legacy))
      expect(readDraft()?.forkParentId).toBeNull()
    })

    it('migrates the interim per-target map, newest content first', () => {
      localStorage.setItem(
        LEGACY_MAP_KEY,
        JSON.stringify({
          new: makeDraft({ fableName: 'Older', savedAt: 1000 }),
          'template:tpl-1': makeDraft({
            fableName: 'Newest',
            forkParentId: 'tpl-1',
            savedAt: 2000,
          }),
        }),
      )

      const migrated = readDraft()
      expect(migrated?.fableName).toBe('Newest')
      expect(migrated?.forkParentId).toBe('tpl-1')
      expect(localStorage.getItem(LEGACY_MAP_KEY)).toBeNull()
      expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    })
  })

  describe('clearDraft', () => {
    it('removes the draft from localStorage', () => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(makeDraft()))
      clearDraft()
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('does not throw when no draft exists', () => {
      expect(() => clearDraft()).not.toThrow()
    })
  })

  describe('flushDraft', () => {
    it('writes the dirty store state immediately and clears the pending flag', () => {
      act(() =>
        useFableBuilderStore.setState({
          fable: makeDraft().fable,
          fableName: 'Flushed',
          forkParentId: 'tpl-9',
          isDirty: true,
          draftWritePending: true,
        }),
      )

      flushDraft()

      expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
      const draft = readDraft()
      expect(draft?.fableName).toBe('Flushed')
      expect(draft?.forkParentId).toBe('tpl-9')
    })

    it('does not write when the store is clean', () => {
      flushDraft()
      expect(readDraft()).toBeNull()
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
    expect(readDraft()).not.toBeNull()
  })

  it('clears the workbench slot on save', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    act(() => vi.advanceTimersByTime(2000))
    expect(readDraft()).not.toBeNull()

    act(() => useFableBuilderStore.getState().markSaved('bp-9', 1))

    expect(readDraft()).toBeNull()
  })

  it('flushes the draft on pagehide (tab close never unmounts)', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(readDraft()).toBeNull()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft()).not.toBeNull()
  })

  it('flushes the draft when the document becomes hidden', () => {
    renderHook(() => useDraftPersistence())

    act(() =>
      useFableBuilderStore.setState({
        fable: makeDraft().fable,
        isDirty: true,
      }),
    )
    expect(readDraft()).toBeNull()

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

    expect(readDraft()).not.toBeNull()
  })

  it('writes the draft on unmount even without a pending debounce', () => {
    const { unmount } = renderHook(() => useDraftPersistence())

    // Mimic a restore: fable set clean, dirty flagged after — no debounce runs.
    act(() => useFableBuilderStore.setState({ fable: makeDraft().fable }))
    act(() => useFableBuilderStore.setState({ isDirty: true }))
    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft()).toBeNull()

    act(() => unmount())

    expect(readDraft()).not.toBeNull()
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
    expect(readDraft()).toBeNull()

    // Navigating away mid-debounce must not strand the flag or lose the draft.
    act(() => unmount())

    expect(useFableBuilderStore.getState().draftWritePending).toBe(false)
    expect(readDraft()).not.toBeNull()
  })
})
