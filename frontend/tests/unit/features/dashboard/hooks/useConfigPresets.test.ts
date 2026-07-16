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
 * Tests the preset data-access hook backed by the Blueprint list API:
 * - Source filtering: only explicitly-saved (`user_defined`, non-one-off) configs
 * - Sorting: favourites first (from localStorage), then backend order
 * - deletePreset: calls backend delete + cleans up favourite flag
 * - toggleFavourite: toggles isFavourite in localStorage
 * - hasPresets: boolean for conditional rendering
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintListItem } from '@/api/types/fable.types'
import { useConfigPresets } from '@/features/dashboard/hooks/useConfigPresets'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { ONEOFF_TAG } from '@/lib/system-tags'

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock toast
vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

// The API layer is stubbed here, so collapse useConfigPresets' useQueries join to an empty result.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useQueries: () => [] }
})

// Three explicitly-saved configs — the baseline visible set.
const DEFAULT_BLUEPRINTS: Array<BlueprintListItem> = [
  {
    blueprint_id: 'bp-001',
    version: 1,
    display_name: 'First Config',
    display_description: 'Description 1',
    tags: ['prod'],
    source: 'user_defined',
    created_by: 'mock-user',
    coreVersionMismatch: null,
  },
  {
    blueprint_id: 'bp-002',
    version: 2,
    display_name: 'Second Config',
    display_description: null,
    tags: [],
    source: 'user_defined',
    created_by: 'mock-user',
    coreVersionMismatch: null,
  },
  {
    blueprint_id: 'bp-003',
    version: 1,
    display_name: null,
    display_description: null,
    tags: ['test', 'europe'],
    source: 'user_defined',
    created_by: 'mock-user',
    coreVersionMismatch: null,
  },
]

// Mutable so individual tests can vary what the mocked API returns.
// Must be `mock`-prefixed to be referenced inside the vi.mock factory.
let mockBlueprints: Array<BlueprintListItem> = DEFAULT_BLUEPRINTS

const mockDeleteBlueprint = vi.fn()

vi.mock('@/api/hooks/useFable', () => ({
  useListBlueprints: () => ({
    data: {
      blueprints: mockBlueprints,
      total: mockBlueprints.length,
      page: 1,
      page_size: 50,
    },
    isLoading: false,
    isError: false,
  }),
  useDeleteBlueprint: () => ({
    mutate: mockDeleteBlueprint,
    isPending: false,
  }),
  useBlockCatalogue: () => ({ data: undefined }),
  fableKeys: {
    all: ['fable'] as const,
    blueprints: () => ['fable', 'blueprints'] as const,
    detail: (id: string) => ['fable', 'detail', id] as const,
  },
}))

function setFavourites(favourites: Record<string, boolean>) {
  localStorage.setItem(
    STORAGE_KEYS.fable.favourites,
    JSON.stringify(favourites),
  )
}

describe('useConfigPresets', () => {
  beforeEach(() => {
    localStorage.clear()
    mockDeleteBlueprint.mockClear()
    mockBlueprints = DEFAULT_BLUEPRINTS
  })

  describe('initialization', () => {
    it('returns presets from the backend API', () => {
      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(3)
      expect(result.current.hasPresets).toBe(true)
    })

    it('maps blueprint fields to PresetEntry', () => {
      const { result } = renderHook(() => useConfigPresets())

      const first = result.current.presets[0]
      expect(first.blueprintId).toBe('bp-001')
      expect(first.displayName).toBe('First Config')
      expect(first.displayDescription).toBe('Description 1')
      expect(first.tags).toEqual(['prod'])
      expect(first.version).toBe(1)
      expect(first.isFavourite).toBe(false)
    })

    it('defaults tags to empty array when null', () => {
      const { result } = renderHook(() => useConfigPresets())

      const second = result.current.presets.find(
        (p) => p.blueprintId === 'bp-002',
      )
      expect(second?.tags).toEqual([])
    })
  })

  describe('source filtering', () => {
    it('excludes blueprints created by a one-off run or schedule', () => {
      mockBlueprints = [
        ...DEFAULT_BLUEPRINTS,
        {
          blueprint_id: 'bp-run',
          version: 1,
          display_name: 'A One-off Run',
          display_description: null,
          tags: ['europe', ONEOFF_TAG],
          source: 'user_defined',
          created_by: 'mock-user',
          coreVersionMismatch: null,
        },
      ]

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(3)
      expect(result.current.presets.map((p) => p.blueprintId)).not.toContain(
        'bp-run',
      )
    })

    it('excludes plugin-template blueprints', () => {
      mockBlueprints = [
        ...DEFAULT_BLUEPRINTS,
        {
          blueprint_id: 'bp-tmpl',
          version: 1,
          display_name: 'Plugin Template',
          display_description: null,
          tags: [],
          source: 'plugin_template',
          created_by: 'mock-user',
          coreVersionMismatch: null,
        },
      ]

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(3)
      expect(result.current.presets.map((p) => p.blueprintId)).not.toContain(
        'bp-tmpl',
      )
    })

    it('hides the section when only one-off runs exist', () => {
      mockBlueprints = [
        {
          blueprint_id: 'bp-run',
          version: 1,
          display_name: 'A One-off Run',
          display_description: null,
          tags: [ONEOFF_TAG],
          source: 'user_defined',
          created_by: 'mock-user',
          coreVersionMismatch: null,
        },
      ]

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets).toHaveLength(0)
      expect(result.current.hasPresets).toBe(false)
    })
  })

  describe('sorting', () => {
    it('sorts favourites before non-favourites', () => {
      setFavourites({ 'bp-003': true })

      const { result } = renderHook(() => useConfigPresets())

      expect(result.current.presets[0].blueprintId).toBe('bp-003')
      expect(result.current.presets[0].isFavourite).toBe(true)
    })
  })

  describe('deletePreset', () => {
    it('calls backend delete with blueprint_id and version', () => {
      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.deletePreset('bp-001', 1)
      })

      // mutate(payload, { onSuccess }) — assert the payload, allow the callback.
      expect(mockDeleteBlueprint).toHaveBeenCalledWith(
        { blueprint_id: 'bp-001', version: 1 },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
    })

    it('cleans up favourite flag on delete', () => {
      setFavourites({ 'bp-001': true, 'bp-002': true })

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.deletePreset('bp-001', 1)
      })

      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.fable.favourites) ?? '{}',
      )
      expect(stored['bp-001']).toBeUndefined()
      expect(stored['bp-002']).toBe(true)
    })
  })

  describe('toggleFavourite', () => {
    it('toggles isFavourite from false to true', () => {
      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('bp-002')
      })

      const updated = result.current.presets.find(
        (p) => p.blueprintId === 'bp-002',
      )
      expect(updated?.isFavourite).toBe(true)
    })

    it('toggles isFavourite from true to false', () => {
      setFavourites({ 'bp-002': true })

      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('bp-002')
      })

      const updated = result.current.presets.find(
        (p) => p.blueprintId === 'bp-002',
      )
      expect(updated?.isFavourite).toBe(false)
    })

    it('persists toggle to localStorage', () => {
      const { result } = renderHook(() => useConfigPresets())

      act(() => {
        result.current.toggleFavourite('bp-001')
      })

      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.fable.favourites) ?? '{}',
      )
      expect(stored['bp-001']).toBe(true)
    })
  })
})
