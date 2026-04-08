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
 * - Sorting: favourites first (from localStorage), then backend order
 * - deletePreset: calls backend delete + cleans up favourite flag
 * - toggleFavourite: toggles isFavourite in localStorage
 * - hasPresets: boolean for conditional rendering
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintListResponse } from '@/api/types/fable.types'
import { useConfigPresets } from '@/features/dashboard/hooks/useConfigPresets'
import { STORAGE_KEYS } from '@/lib/storage-keys'

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

const mockListResponse: BlueprintListResponse = {
  blueprints: [
    {
      blueprint_id: 'bp-001',
      version: 1,
      display_name: 'First Config',
      display_description: 'Description 1',
      tags: ['prod'],
      source: null,
      created_by: null,
    },
    {
      blueprint_id: 'bp-002',
      version: 2,
      display_name: 'Second Config',
      display_description: null,
      tags: null,
      source: null,
      created_by: null,
    },
    {
      blueprint_id: 'bp-003',
      version: 1,
      display_name: null,
      display_description: null,
      tags: ['test', 'europe'],
      source: null,
      created_by: null,
    },
  ],
  total: 3,
  page: 1,
  page_size: 50,
}

const mockDeleteBlueprint = vi.fn()

vi.mock('@/api/hooks/useFable', () => ({
  useListBlueprints: () => ({
    data: mockListResponse,
    isLoading: false,
    isError: false,
  }),
  useDeleteBlueprint: () => ({
    mutate: mockDeleteBlueprint,
    isPending: false,
  }),
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

      expect(mockDeleteBlueprint).toHaveBeenCalledWith({
        blueprint_id: 'bp-001',
        version: 1,
      })
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
