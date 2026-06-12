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
 * Preset API Hooks
 *
 * TanStack Query hooks for high-level preset operations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  HighLevelPreset,
  PresetCreateRequest,
  PresetCreateResponse,
  PresetDeleteRequest,
  PresetInstantiateRequest,
  PresetInstantiateResponse,
  PresetListResponse,
  PresetPublishRequest,
  PresetUpdateRequest,
  PresetUpdateResponse,
} from '@/api/types/preset.types'
import {
  createPreset,
  deletePreset,
  getPreset,
  instantiatePreset,
  listPresets,
  publishPreset,
  updatePreset,
} from '@/api/endpoints/preset'
import { QUERY_CONSTANTS } from '@/utils/constants'

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const presetKeys = {
  all: ['presets'] as const,
  // Prefix shared by every paginated preset-list query — invalidate to refresh all.
  listsBase: () => [...presetKeys.all, 'list'] as const,
  list: (
    page: number,
    pageSize: number,
    filters?: {
      difficulty?: string
      search?: string
      published_only?: boolean
    },
  ) => [...presetKeys.all, 'list', page, pageSize, filters] as const,
  detail: (presetId: string) =>
    [...presetKeys.all, 'detail', presetId] as const,
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * List presets (paginated) with optional difficulty / search filters.
 *
 * Pass ``{ published_only: false }`` in filters to include unpublished presets
 * (admin-only — the backend enforces the permission check).
 *
 * Wraps GET /api/v1/presets/list
 */
export function usePresetList(
  filters?: {
    difficulty?: string
    search?: string
    published_only?: boolean
  },
  page: number = 1,
  pageSize: number = 20,
) {
  return useQuery<PresetListResponse>({
    queryKey: presetKeys.list(page, pageSize, filters),
    queryFn: () => listPresets(page, pageSize, filters),
    staleTime: QUERY_CONSTANTS.STALE_TIMES.DEFAULT,
  })
}

/**
 * Fetch a single preset by ID.
 *
 * Wraps GET /api/v1/presets/get?preset_id=...
 *
 * The query is disabled until a non-empty `presetId` is provided.
 * 4xx errors (e.g. 404 Not Found) are not retried.
 */
export function usePreset(presetId: string | null | undefined) {
  return useQuery<HighLevelPreset>({
    queryKey: presetKeys.detail(presetId ?? ''),
    queryFn: () => getPreset(presetId!),
    enabled: !!presetId,
    staleTime: QUERY_CONSTANTS.STALE_TIMES.LONG,
  })
}

/**
 * Instantiate a preset into a ready-to-run builder.
 *
 * Wraps POST /api/v1/presets/instantiate
 *
 * On success the preset detail cache is invalidated so any subsequent
 * `usePreset` call for the same ID reflects the latest state.
 */
export function useInstantiatePreset() {
  const queryClient = useQueryClient()

  return useMutation<
    PresetInstantiateResponse,
    Error,
    PresetInstantiateRequest
  >({
    mutationFn: instantiatePreset,
    onSuccess: (_data, variables) => {
      // Invalidate the detail cache for the instantiated preset so callers
      // always see fresh data if they re-fetch after instantiation.
      queryClient.invalidateQueries({
        queryKey: presetKeys.detail(variables.preset_id),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new preset (admin-only).
 *
 * Wraps POST /api/v1/presets/create
 *
 * On success all preset list queries are invalidated.
 */
export function useCreatePreset() {
  const queryClient = useQueryClient()

  return useMutation<PresetCreateResponse, Error, PresetCreateRequest>({
    mutationFn: createPreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetKeys.listsBase() })
    },
  })
}

/**
 * Update an existing preset (admin-only).
 *
 * Wraps POST /api/v1/presets/update
 *
 * On success the detail cache for the updated preset and all list queries
 * are invalidated.
 */
export function useUpdatePreset() {
  const queryClient = useQueryClient()

  return useMutation<PresetUpdateResponse, Error, PresetUpdateRequest>({
    mutationFn: updatePreset,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: presetKeys.detail(variables.preset_id),
      })
      queryClient.invalidateQueries({ queryKey: presetKeys.listsBase() })
    },
  })
}

/**
 * Soft-delete a preset (admin-only).
 *
 * Wraps POST /api/v1/presets/delete
 *
 * On success all preset list queries are invalidated.
 */
export function useDeletePreset() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, PresetDeleteRequest>({
    mutationFn: deletePreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetKeys.listsBase() })
    },
  })
}

/**
 * Update publish status in-place (admin-only).
 *
 * Wraps POST /api/v1/presets/publish
 *
 * Unlike `useUpdatePreset`, this does NOT increment the preset version.
 * On success the detail cache for the affected preset and all list queries
 * are invalidated.
 */
export function usePublishPreset() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, PresetPublishRequest>({
    mutationFn: publishPreset,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: presetKeys.detail(variables.preset_id),
      })
      queryClient.invalidateQueries({ queryKey: presetKeys.listsBase() })
    },
  })
}
