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
 * useConfigPresets Hook Unit Tests
 *
 * Tests the preset data-access hook:
 * - Sorting: favourites first, then by date descending
 * - deletePreset: removes a preset from the store
 * - toggleFavourite: toggles isFavourite on a preset
 * - hasPresets: boolean for conditional rendering
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FableMetadataStore } from '@/features/fable-builder/components/SaveConfigPopover'
import { useConfigPresets } from '@/features/dashboard/hooks/useConfigPresets'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock logger to suppress expected error output in tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock toast to suppress notifications
vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function setMockPresets(presets: FableMetadataStore) {
  localStorage.setItem(STORAGE_KEYS.fable.metadata, JSON.stringify(presets))
}

const basePresets: FableMetadataStore = {
  'fable-001': {
    title: 'Oldest',
    comments: '',
    summary: { source: 1, transform: 0, product: 1, sink: 1 },
    savedAt: '2026-01-01T10:00:00Z',
    isFavourite: false,
  },
  'fable-002': {
    title: 'Middle',
    comments: 'Some notes',
    summary: { source: 1, transform: 0, product: 0, sink: 1 },
    savedAt: '2026-01-10T10:00:00Z',
    isFavourite: false,
  },
  'fable-003': {
    title: 'Newest',
    comments: '',
    summary: { source: 2, transform: 0, product: 1, sink: 0 },
    savedAt: '2026-02-01T10:00:00Z',
    isFavourite: false,
  },
}

describe('useConfigPresets', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('initialization', () => {
    it('returns empty presets when no data in localStorage', () => {
      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(0)
      expect(result.current.hasPresets).toBe(false)
    })

    it('returns presets from localStorage', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(3)
      expect(result.current.hasPresets).toBe(true)
    })
  })

  describe('sorting', () => {
    it('sorts by date descending (newest first)', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets[0].title).toBe('Newest')
      expect(result.current.presets[1].title).toBe('Middle')
      expect(result.current.presets[2].title).toBe('Oldest')
    })

    it('sorts favourites before non-favourites', () => {
      setMockPresets({
        ...basePresets,
        'fable-001': { ...basePresets['fable-001'], isFavourite: true },
      })

      const { result } = renderHook(() => useConfigPresets())

      // fable-001 (Oldest) is favourite, so it comes first
      expect(result.current.presets[0].title).toBe('Oldest')
      expect(result.current.presets[0].isFavourite).toBe(true)
      // Then newest non-favourites
      expect(result.current.presets[1].title).toBe('Newest')
      expect(result.current.presets[2].title).toBe('Middle')
    })

    it('sorts multiple favourites by date descending', () => {
      setMockPresets({
        ...basePresets,
        'fable-001': { ...basePresets['fable-001'], isFavourite: true },
        'fable-003': { ...basePresets['fable-003'], isFavourite: true },
      })

      const { result } = renderHook(() => useConfigPresets())

      // Both favourites first, newest favourite first
      expect(result.current.presets[0].title).toBe('Newest')
      expect(result.current.presets[1].title).toBe('Oldest')
      // Then non-favourite
      expect(result.current.presets[2].title).toBe('Middle')
    })
  })

  describe('deletePreset', () => {
    it('removes a preset from the store', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(3)

      act(() => {
        result.current.deletePreset('fable-002')
      })

      expect(result.current.presets).toHaveLength(2)
      expect(
        result.current.presets.find((p) => p.fableId === 'fable-002'),
      ).toBeUndefined()
    })

    it('persists deletion to localStorage', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.deletePreset('fable-001')
      })

      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.fable.metadata) ?? '{}',
      ) as FableMetadataStore
      expect(stored['fable-001']).toBeUndefined()
      expect(stored['fable-002']).toBeDefined()
      expect(stored['fable-003']).toBeDefined()
    })
  })

  describe('toggleFavourite', () => {
    it('toggles isFavourite from false to true', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      const preset = result.current.presets.find(
        (p) => p.fableId === 'fable-002',
      )
      expect(preset?.isFavourite).toBeFalsy()

      act(() => {
        result.current.toggleFavourite('fable-002')
      })

      const updated = result.current.presets.find(
        (p) => p.fableId === 'fable-002',
      )
      expect(updated?.isFavourite).toBe(true)
    })

    it('toggles isFavourite from true to false', () => {
      setMockPresets({
        ...basePresets,
        'fable-002': { ...basePresets['fable-002'], isFavourite: true },
      })

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('fable-002')
      })

      const updated = result.current.presets.find(
        (p) => p.fableId === 'fable-002',
      )
      expect(updated?.isFavourite).toBe(false)
    })

    it('does nothing for non-existent fableId', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('nonexistent')
      })

      // All presets should remain unchanged
      expect(result.current.presets).toHaveLength(3)
    })

    it('persists toggle to localStorage', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('fable-001')
      })

      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.fable.metadata) ?? '{}',
      ) as FableMetadataStore
      expect(stored['fable-001'].isFavourite).toBe(true)
    })
  })

  describe('hasPresets', () => {
    it('returns false when no presets exist', () => {
      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.hasPresets).toBe(false)
    })

    it('returns true when presets exist', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.hasPresets).toBe(true)
    })

    it('returns false after deleting all presets', () => {
      setMockPresets({
        'fable-001': basePresets['fable-001'],
      })

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.hasPresets).toBe(true)

      act(() => {
        result.current.deletePreset('fable-001')
      })

      expect(result.current.hasPresets).toBe(false)
    })
  })

  describe('preset entries', () => {
    it('includes fableId in each entry', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      for (const preset of result.current.presets) {
        expect(preset.fableId).toBeTruthy()
      }
    })

    it('includes all metadata fields', () => {
      setMockPresets(basePresets)

      const { result } = renderHook(() => useConfigPresets())

      const preset = result.current.presets.find(
        (p) => p.fableId === 'fable-002',
      )
      expect(preset).toBeDefined()
      expect(preset?.title).toBe('Middle')
      expect(preset?.comments).toBe('Some notes')
      expect(preset?.summary).toEqual({
        source: 1,
        transform: 0,
        product: 0,
        sink: 1,
      })
      expect(preset?.savedAt).toBe('2026-01-10T10:00:00Z')
    })
  })
})
