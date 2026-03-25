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
 * Artifacts API Endpoints
 *
 * API functions for ML model artifact management.
 */

import type {
  ArtifactActionResponse,
  CompositeArtifactId,
  MlModelDetail,
  MlModelOverview,
} from '@/api/types/artifacts.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  ArtifactActionResponseSchema,
  MlModelDetailSchema,
  MlModelListSchema,
} from '@/api/types/artifacts.types'

/**
 * List all available ML models
 */
export async function listModels(): Promise<Array<MlModelOverview>> {
  return apiClient.get(API_ENDPOINTS.artifacts.listModels, {
    schema: MlModelListSchema,
  })
}

/**
 * Get details for a specific model
 */
export async function getModelDetails(
  compositeId: CompositeArtifactId,
): Promise<MlModelDetail> {
  return apiClient.post(API_ENDPOINTS.artifacts.modelDetails, compositeId, {
    schema: MlModelDetailSchema,
  })
}

/**
 * Download a model
 */
export async function downloadModel(
  compositeId: CompositeArtifactId,
): Promise<ArtifactActionResponse> {
  return apiClient.post(API_ENDPOINTS.artifacts.downloadModel, compositeId, {
    schema: ArtifactActionResponseSchema,
  })
}

/**
 * Delete a model
 */
export async function deleteModel(
  compositeId: CompositeArtifactId,
): Promise<ArtifactActionResponse> {
  return apiClient.post(API_ENDPOINTS.artifacts.deleteModel, compositeId, {
    schema: ArtifactActionResponseSchema,
  })
}
