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
 * Fable API Endpoints
 *
 * API functions for fable (configuration builder) operations.
 */

import { z } from 'zod'
import type {
  BlockFactoryCatalogue,
  BlueprintDeleteRequest,
  BlueprintListResponse,
  BlueprintUpdateRequest,
  FableBuilderV1,
  FableRetrieveResponse,
  FableUpsertRequest,
  FableUpsertResponse,
  FableValidationExpansion,
  VariableDetail,
} from '@/api/types/fable.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  BlockFactoryCatalogueSchema,
  BlueprintListResponseSchema,
  FableRetrieveResponseSchema,
  FableUpsertResponseSchema,
  FableValidationExpansionSchema,
  VariableDetailSchema,
  normalizeCatalogueKeys,
} from '@/api/types/fable.types'

/**
 * Get the block factory catalogue
 *
 * The backend returns catalogue keys in Python repr format: "store='ecmwf' local='toy1'"
 * This function normalizes them to display format: "ecmwf/toy1"
 *
 * @param language - Optional ISO 639-1 language code for localized content (e.g., 'de', 'fr')
 */
export async function getCatalogue(
  language?: string,
): Promise<BlockFactoryCatalogue> {
  const rawCatalogue = await apiClient.get(API_ENDPOINTS.fable.catalogue, {
    params: language ? { language } : undefined,
    schema: BlockFactoryCatalogueSchema,
  })

  // Normalize the keys from Python repr format to display format
  // Type assertion is safe because the schema validates the response
  return normalizeCatalogueKeys(
    rawCatalogue as Record<string, BlockFactoryCatalogue[string]>,
  )
}

/**
 * Expand a fable configuration for validation
 */
export async function expandFable(
  fable: FableBuilderV1,
): Promise<FableValidationExpansion> {
  return apiClient.put(API_ENDPOINTS.fable.expand, fable, {
    schema: FableValidationExpansionSchema,
  })
}

/**
 * Retrieve a saved fable by ID, returning builder and metadata
 */
export async function retrieveFable(
  fableId: string,
  version?: number,
): Promise<FableRetrieveResponse> {
  const params: Record<string, string | number> = {
    blueprint_id: fableId,
  }
  if (version !== undefined) {
    params.version = version
  }
  return apiClient.get(API_ENDPOINTS.fable.get, {
    params,
    schema: FableRetrieveResponseSchema,
  })
}

/**
 * Create a fable with full metadata, returning { blueprint_id, version }
 */
export async function upsertFable(
  request: FableUpsertRequest,
): Promise<FableUpsertResponse> {
  return apiClient.post(API_ENDPOINTS.fable.create, request, {
    schema: FableUpsertResponseSchema,
  })
}

/**
 * List all saved blueprints (paginated)
 */
export async function listBlueprints(
  page: number = 1,
  pageSize: number = 10,
): Promise<BlueprintListResponse> {
  return apiClient.get(API_ENDPOINTS.fable.list, {
    params: { page, page_size: pageSize },
    schema: BlueprintListResponseSchema,
  })
}

/**
 * Update an existing blueprint (requires version for optimistic concurrency)
 */
export async function updateBlueprint(
  request: BlueprintUpdateRequest,
): Promise<FableUpsertResponse> {
  return apiClient.post(API_ENDPOINTS.fable.update, request, {
    schema: FableUpsertResponseSchema,
  })
}

/**
 * Delete a blueprint (requires version for optimistic concurrency)
 */
export async function deleteBlueprint(
  request: BlueprintDeleteRequest,
): Promise<void> {
  return apiClient.post(API_ENDPOINTS.fable.delete, request)
}

/**
 * List available automatic variables for ${variable} interpolation in block configs
 */
export async function getAvailableVariables(): Promise<Array<VariableDetail>> {
  return apiClient.get(API_ENDPOINTS.fable.variablesList, {
    schema: z.array(VariableDetailSchema),
  })
}
