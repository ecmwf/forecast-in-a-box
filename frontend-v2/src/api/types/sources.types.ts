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
 * Sources Types
 *
 * Types for the sources management API endpoints.
 * Sources are data providers for Fables - AI models and datasets.
 *
 * Key concepts:
 * - Store: Storage for model checkpoints and datasets (e.g., HuggingFace).
 *   Not FIAB-specific, responsible for persistence and access to underlying data.
 * - Registry: Lightweight FIAB adapter that points to one or more Stores.
 *   Provides indirection, metadata, and fast access without owning the data.
 */

import { z } from 'zod'

/**
 * Source status values
 */
export const sourceStatusValues = [
  'available',
  'downloading',
  'ready',
  'configuring',
  'error',
  'disabled',
] as const

export type SourceStatus = (typeof sourceStatusValues)[number]

/**
 * Source type values (based on providing plugin)
 */
export const sourceTypeValues = ['model', 'dataset'] as const

export type SourceType = (typeof sourceTypeValues)[number]

/**
 * Source information
 */
export interface SourceInfo {
  id: string
  factoryId: string
  name: string
  description: string
  sourceType: SourceType
  pluginId: string
  pluginName: string
  author: string
  version: string
  status: SourceStatus
  isEnabled: boolean
  isDefault: boolean

  // Download info (for model type)
  downloadProgress?: number
  downloadError?: string | null

  // Configuration info
  configurationSchema?: Record<string, unknown>
  configurationValues?: Record<string, string>

  // Metadata
  iconName?: string
  registry?: string
  registryId?: string
  size?: string
  installedAt?: string
}

/**
 * Sources statistics for dashboard
 */
export interface SourcesStats {
  totalCount: number
  readyCount: number
  downloadingCount: number
  byType: Record<SourceType, number>
  byPlugin: Record<string, number>
}

// Zod schemas for runtime validation

export const sourceStatusSchema = z.enum(sourceStatusValues)

export const sourceTypeSchema = z.enum(sourceTypeValues)

export const sourceInfoSchema = z.object({
  id: z.string(),
  factoryId: z.string(),
  name: z.string(),
  description: z.string(),
  sourceType: sourceTypeSchema,
  pluginId: z.string(),
  pluginName: z.string(),
  author: z.string(),
  version: z.string(),
  status: sourceStatusSchema,
  isEnabled: z.boolean(),
  isDefault: z.boolean(),
  downloadProgress: z.number().optional(),
  downloadError: z.string().nullable().optional(),
  configurationSchema: z.record(z.string(), z.unknown()).optional(),
  configurationValues: z.record(z.string(), z.string()).optional(),
  iconName: z.string().optional(),
  registry: z.string().optional(),
  registryId: z.string().optional(),
  size: z.string().optional(),
  installedAt: z.string().optional(),
})

export const sourcesStatsSchema = z.object({
  totalCount: z.number(),
  readyCount: z.number(),
  downloadingCount: z.number(),
  byType: z.record(sourceTypeSchema, z.number()),
  byPlugin: z.record(z.string(), z.number()),
})

/**
 * Source type metadata for UI display
 */
export interface SourceTypeMetadata {
  type: SourceType
  label: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  icon: string
}

export const SOURCE_TYPE_METADATA: Record<SourceType, SourceTypeMetadata> = {
  model: {
    type: 'model',
    label: 'AI Model',
    description: 'AI weather model checkpoint',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-200 dark:border-blue-800',
    icon: 'Brain',
  },
  dataset: {
    type: 'dataset',
    label: 'Dataset',
    description: 'Pre-existing forecast dataset',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    borderColor: 'border-purple-200 dark:border-purple-800',
    icon: 'Database',
  },
}

// ============================================
// Registry Types
// ============================================

/**
 * Source Registry
 *
 * A lightweight FIAB adapter that points to one or more Stores.
 * Provides indirection, metadata, and fast access without owning the data.
 */
export interface SourceRegistry {
  id: string
  name: string
  description: string
  url: string
  isDefault: boolean
  isConnected: boolean
  sourcesCount: number
  stores: Array<{
    id: string
    name: string
    url: string
    type: 'huggingface' | 's3' | 'gcs' | 'local' | 'other'
  }>
  lastSyncedAt?: string
}

export const sourceRegistrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  isDefault: z.boolean(),
  isConnected: z.boolean(),
  sourcesCount: z.number(),
  stores: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      type: z.enum(['huggingface', 's3', 'gcs', 'local', 'other']),
    }),
  ),
  lastSyncedAt: z.string().optional(),
})

/**
 * Add registry request
 */
export interface AddRegistryRequest {
  name: string
  url: string
}

export const addRegistryRequestSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
})

/**
 * Sources API response (includes registries)
 */
export interface SourcesApiResponse {
  sources: Array<SourceInfo>
  registries: Array<SourceRegistry>
}

export const sourcesApiResponseSchema = z.object({
  sources: z.array(sourceInfoSchema),
  registries: z.array(sourceRegistrySchema),
})
