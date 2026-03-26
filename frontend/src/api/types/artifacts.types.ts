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
 * Artifact Types and Schemas
 *
 * Type definitions and Zod schemas for the ML model artifacts API.
 * These types match the backend API exactly.
 */

import { z } from 'zod'

/**
 * Composite artifact ID - identifies a model by store and checkpoint
 */
export const CompositeArtifactIdSchema = z.object({
  artifact_store_id: z.string(),
  ml_model_checkpoint_id: z.string(),
})

export type CompositeArtifactId = z.infer<typeof CompositeArtifactIdSchema>

/**
 * Encode a CompositeArtifactId for use in URL path segments.
 * Format: "storeId--checkpointId"
 */
export function encodeArtifactId(id: CompositeArtifactId): string {
  return `${id.artifact_store_id}--${id.ml_model_checkpoint_id}`
}

/**
 * Decode a URL path segment back to a CompositeArtifactId.
 * Expects "storeId--checkpointId" format.
 */
export function decodeArtifactId(encoded: string): CompositeArtifactId {
  const separatorIndex = encoded.indexOf('--')
  if (separatorIndex === -1) {
    return { artifact_store_id: encoded, ml_model_checkpoint_id: '' }
  }
  return {
    artifact_store_id: encoded.slice(0, separatorIndex),
    ml_model_checkpoint_id: encoded.slice(separatorIndex + 2),
  }
}

/**
 * ML model overview from list endpoint
 */
export const MlModelOverviewSchema = z.object({
  composite_id: CompositeArtifactIdSchema,
  display_name: z.string(),
  display_author: z.string(),
  disk_size_bytes: z.number(),
  supported_platforms: z.array(z.string()),
  is_available: z.boolean(),
})

export type MlModelOverview = z.infer<typeof MlModelOverviewSchema>

/**
 * ML model detail from detail endpoint (extends overview)
 */
export const MlModelDetailSchema = MlModelOverviewSchema.extend({
  display_description: z.string(),
  url: z.string(),
  pip_package_constraints: z.array(z.string()),
  output_characteristics: z.array(z.string()),
  input_characteristics: z.array(z.string()),
})

export type MlModelDetail = z.infer<typeof MlModelDetailSchema>

/**
 * List models response
 */
export const MlModelListSchema = z.array(MlModelOverviewSchema)

/**
 * Download/delete response
 *
 * Note: The backend returns composite_id as a Python repr string
 * (e.g. "CompositeArtifactId(artifact_store_id='x', ml_model_checkpoint_id='y')")
 * via str(), not as a JSON object. We accept it as a string here.
 */
export const ArtifactActionResponseSchema = z.object({
  status: z.string(),
  composite_id: z.string().optional(),
  progress: z.number().optional(),
})

export type ArtifactActionResponse = z.infer<
  typeof ArtifactActionResponseSchema
>

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * UI-friendly artifact info (transformed from MlModelOverview)
 */
export interface ArtifactInfo {
  id: CompositeArtifactId
  encodedId: string
  displayName: string
  author: string
  diskSize: string
  diskSizeBytes: number
  platforms: Array<string>
  isAvailable: boolean
}

/**
 * Transform a MlModelOverview to UI-friendly ArtifactInfo
 */
export function toArtifactInfo(model: MlModelOverview): ArtifactInfo {
  return {
    id: model.composite_id,
    encodedId: encodeArtifactId(model.composite_id),
    displayName: model.display_name,
    author: model.display_author,
    diskSize: formatBytes(model.disk_size_bytes),
    diskSizeBytes: model.disk_size_bytes,
    platforms: model.supported_platforms,
    isAvailable: model.is_available,
  }
}
