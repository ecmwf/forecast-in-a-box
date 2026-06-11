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
 * Preset API Endpoints
 *
 * API functions for high-level preset operations.
 */

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
  HighLevelPresetSchema,
  PresetInstantiateResponseSchema,
  PresetListResponseSchema,
} from '@/api/types/preset.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'

/**
 * List presets (paginated), with optional filters.
 *
 * Pass ``published_only: false`` (admin-only) to include unpublished presets.
 */
export async function listPresets(
  page: number = 1,
  pageSize: number = 20,
  filters?: {
    difficulty?: string
    search?: string
    published_only?: boolean
  },
): Promise<PresetListResponse> {
  const params: Record<string, string | number | boolean> = {
    page,
    page_size: pageSize,
  }
  if (filters?.difficulty) params.difficulty = filters.difficulty
  if (filters?.search) params.search = filters.search
  if (filters?.published_only === false) params.published_only = false
  return apiClient.get(API_ENDPOINTS.preset.list, {
    params,
    schema: PresetListResponseSchema,
  })
}

/**
 * Get a single preset by ID.
 */
export async function getPreset(presetId: string): Promise<HighLevelPreset> {
  return apiClient.get(API_ENDPOINTS.preset.get, {
    params: { preset_id: presetId },
    schema: HighLevelPresetSchema,
  })
}

/**
 * Instantiate a preset into a ready-to-run builder.
 */
export async function instantiatePreset(
  request: PresetInstantiateRequest,
): Promise<PresetInstantiateResponse> {
  return apiClient.post(API_ENDPOINTS.preset.instantiate, request, {
    schema: PresetInstantiateResponseSchema,
  })
}

/**
 * Create a new preset (admin-only).
 */
export async function createPreset(
  request: PresetCreateRequest,
): Promise<PresetCreateResponse> {
  return apiClient.post(API_ENDPOINTS.preset.create, request)
}

/**
 * Update an existing preset (admin-only).
 * Uses optimistic locking via ``version``.
 */
export async function updatePreset(
  request: PresetUpdateRequest,
): Promise<PresetUpdateResponse> {
  return apiClient.post(API_ENDPOINTS.preset.update, request)
}

/**
 * Soft-delete a preset (admin-only).
 * Uses optimistic locking via ``version``.
 */
export async function deletePreset(
  request: PresetDeleteRequest,
): Promise<void> {
  return apiClient.post(API_ENDPOINTS.preset.delete, request)
}

/**
 * Update publish status in-place (admin-only).
 * Does NOT increment the preset version — use this instead of ``updatePreset``
 * when only toggling ``is_published``.
 * Uses optimistic locking via ``version``.
 */
export async function publishPreset(
  request: PresetPublishRequest,
): Promise<void> {
  return apiClient.post(API_ENDPOINTS.preset.publish, request)
}
