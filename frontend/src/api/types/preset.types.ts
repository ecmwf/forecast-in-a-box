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
 * Preset Types & Schemas
 *
 * TypeScript types matching the backend preset API contracts defined in
 * routes/preset.py. Field names are kept in snake_case to match the wire
 * format exactly.
 */

import { z } from 'zod'
import { FableBuilderV1Schema } from './fable.types'
import type { FableBuilderV1 } from './fable.types'

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/** routes/preset.py: PresetDifficultyLiteral */
export const PresetDifficultySchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
])

export type PresetDifficulty = 'beginner' | 'intermediate' | 'advanced'

// ---------------------------------------------------------------------------
// PresetParameter
// ---------------------------------------------------------------------------

/** routes/preset.py: PresetParameterContract */
export const PresetParameterSchema = z.object({
  glyph_key: z.string(),
  label: z.string(),
  description: z.string(),
  /** FableType string (e.g. "string", "integer", "enum"). */
  value_type: z.string(),
  default_value: z.string(),
})

export type PresetParameter = z.infer<typeof PresetParameterSchema>

// ---------------------------------------------------------------------------
// HighLevelPreset  (full detail — maps to PresetGetResponse on the backend)
// ---------------------------------------------------------------------------

/** routes/preset.py: PresetGetResponse — full preset including builder_template. */
export const HighLevelPresetSchema = z.object({
  preset_id: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string(),
  long_description: z.string().nullable().optional(),
  difficulty: PresetDifficultySchema,
  tags: z.array(z.string()).default([]),
  icon: z.string(),
  builder_template: FableBuilderV1Schema,
  parameters: z.array(PresetParameterSchema).default([]),
  is_published: z.boolean(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export interface HighLevelPreset {
  preset_id: string
  version: number
  name: string
  description: string
  long_description: string | null
  difficulty: PresetDifficulty
  tags: Array<string>
  icon: string
  builder_template: FableBuilderV1
  parameters: Array<PresetParameter>
  is_published: boolean
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

// ---------------------------------------------------------------------------
// PresetListItem  (summary — maps to PresetListItem on the backend)
// ---------------------------------------------------------------------------

/** routes/preset.py: PresetListItem — summary including builder_template (for mini preview); parameters omitted. */
export const PresetListItemSchema = z.object({
  preset_id: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string(),
  difficulty: PresetDifficultySchema,
  tags: z.array(z.string()).default([]),
  icon: z.string(),
  builder_template: FableBuilderV1Schema,
  is_published: z.boolean(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export interface PresetListItem {
  preset_id: string
  version: number
  name: string
  description: string
  difficulty: PresetDifficulty
  tags: Array<string>
  icon: string
  builder_template: FableBuilderV1
  is_published: boolean
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

// ---------------------------------------------------------------------------
// PresetListResponse  (paginated wrapper)
// ---------------------------------------------------------------------------

/** routes/preset.py: PresetListResponse */
export const PresetListResponseSchema = z.object({
  presets: z.array(PresetListItemSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type PresetListResponse = z.infer<typeof PresetListResponseSchema>

// ---------------------------------------------------------------------------
// Admin write request / response types
// ---------------------------------------------------------------------------

/**
 * routes/preset.py: PresetCreateRequest — admin-only.
 */
export interface PresetCreateRequest {
  name: string
  description: string
  long_description?: string | null
  difficulty: PresetDifficulty
  tags?: Array<string>
  icon?: string
  builder_template: FableBuilderV1
  parameters?: Array<PresetParameter>
  is_published?: boolean
}

/**
 * routes/preset.py: PresetCreateResponse
 */
export interface PresetCreateResponse {
  preset_id: string
  version: number
}

/**
 * routes/preset.py: PresetUpdateRequest — admin-only.
 * ``version`` is the current latest version (optimistic lock).
 */
export interface PresetUpdateRequest {
  preset_id: string
  version: number
  name: string
  description: string
  long_description?: string | null
  difficulty: PresetDifficulty
  tags?: Array<string>
  icon?: string
  builder_template: FableBuilderV1
  parameters?: Array<PresetParameter>
  is_published?: boolean
}

/**
 * routes/preset.py: PresetUpdateResponse
 */
export interface PresetUpdateResponse {
  preset_id: string
  version: number
}

/**
 * routes/preset.py: PresetDeleteRequest — admin-only.
 * ``version`` must match the current latest version (optimistic lock).
 */
export interface PresetDeleteRequest {
  preset_id: string
  version: number
}

/**
 * routes/preset.py: PresetPublishRequest — admin-only.
 * Updates publish status in-place without incrementing the version.
 * ``version`` is used for optimistic locking.
 */
export interface PresetPublishRequest {
  preset_id: string
  version: number
  is_published: boolean
}

// ---------------------------------------------------------------------------
// Instantiate request / response
// ---------------------------------------------------------------------------

/**
 * routes/preset.py: PresetInstantiateRequest — outbound only (not validated).
 *
 * ``parameter_values`` maps glyph keys to string values; absent keys fall back
 * to each parameter's ``default_value``.
 *
 * ``auto_run`` controls whether a run is submitted immediately after saving the
 * blueprint (``true``, the default) or whether only the blueprint is saved and
 * returned for the caller to open in the editor (``false``).
 */
export interface PresetInstantiateRequest {
  preset_id: string
  parameter_values: Record<string, string>
  /** When false, saves the blueprint but does not submit a run. Defaults to true. */
  auto_run?: boolean
}

/**
 * routes/preset.py: PresetInstantiateResponse.
 *
 * When ``auto_run=true`` (the default) all fields are populated.
 * When ``auto_run=false`` ``blueprint_id`` and ``blueprint_version`` are set
 * but ``run_id`` and ``attempt_count`` are ``null`` — the caller opens the
 * blueprint in the editor and submits manually.
 */
export const PresetInstantiateResponseSchema = z.object({
  builder: FableBuilderV1Schema,
  blueprint_id: z.string().nullable(),
  blueprint_version: z.number().nullable(),
  run_id: z.string().nullable(),
  attempt_count: z.number().nullable(),
})

export interface PresetInstantiateResponse {
  builder: FableBuilderV1
  blueprint_id: string | null
  blueprint_version: number | null
  run_id: string | null
  attempt_count: number | null
}
