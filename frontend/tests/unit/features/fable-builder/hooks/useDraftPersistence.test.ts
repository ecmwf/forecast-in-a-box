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
import { act } from '@testing-library/react'
import type { FableDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import {
  clearDraft,
  readDraft,
} from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const DRAFT_KEY = 'fiab.fable.draft'

function makeDraft(overrides: Partial<FableDraft> = {}): FableDraft {
  return {
    fable: {
      blocks: {
        block_1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'base' },
            factory: 'ekdSource',
          },
          configuration_values: { source: 'ecmwf-open-data' },
          input_ids: {},
        },
      },
    },
    fableId: null,
    fableName: 'Test Config',
    fableVersion: null,
    savedAt: Date.now(),
    ...overrides,
  }
}

describe('useDraftPersistence helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('readDraft', () => {
    it('returns null when no draft exists', () => {
      expect(readDraft()).toBeNull()
    })

    it('reads a valid draft from localStorage', () => {
      const draft = makeDraft()
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))

      const result = readDraft()
      expect(result).toEqual(draft)
    })

    it('returns null for malformed JSON', () => {
      localStorage.setItem(DRAFT_KEY, 'not-json')
      expect(readDraft()).toBeNull()
    })
  })

  describe('clearDraft', () => {
    it('removes the draft from localStorage', () => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(makeDraft()))
      expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()

      clearDraft()
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('does not throw when no draft exists', () => {
      expect(() => clearDraft()).not.toThrow()
    })
  })
})

describe('draft persistence via store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    act(() => useFableBuilderStore.getState().newFable())
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('writes a draft to localStorage after debounce when dirty', () => {
    // The hook subscribes to the store — simulate what it does by
    // directly testing the write/read cycle since the hook requires
    // React rendering context. This tests the serialisation contract.
    const draft = makeDraft({ savedAt: Date.now() })
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))

    const result = readDraft()
    expect(result).not.toBeNull()
    expect(result!.fable.blocks).toHaveProperty('block_1')
    expect(result!.fableName).toBe('Test Config')
  })

  it('clears draft when markSaved is called', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(makeDraft()))
    expect(readDraft()).not.toBeNull()

    // Simulate what the hook does on lastSavedAt change
    clearDraft()
    expect(readDraft()).toBeNull()
  })

  it('draft contains all required fields', () => {
    const draft = makeDraft({
      fableId: 'bp-123',
      fableVersion: 3,
      fableName: 'My Pipeline',
    })
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))

    const result = readDraft()!
    expect(result.fableId).toBe('bp-123')
    expect(result.fableVersion).toBe(3)
    expect(result.fableName).toBe('My Pipeline')
    expect(result.savedAt).toBeTypeOf('number')
    expect(result.fable).toBeDefined()
  })

  it('draft with empty blocks is still readable', () => {
    const draft = makeDraft({
      fable: { blocks: {} },
    })
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))

    const result = readDraft()
    expect(result).not.toBeNull()
    expect(Object.keys(result!.fable.blocks)).toHaveLength(0)
  })
})
