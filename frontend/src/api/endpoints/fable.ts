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

import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
  FableCompileV2Request,
  FableRetrieveV2Response,
  FableUpsertV2Request,
  FableUpsertV2Response,
  FableValidationExpansion,
} from '@/api/types/fable.types'
import type { ExecutionSpecification } from '@/api/types/job.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  BlockFactoryCatalogueSchema,
  FableRetrieveV2ResponseSchema,
  FableUpsertV2ResponseSchema,
  FableValidationExpansionSchema,
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
 * Retrieve a saved fable by ID, returning builder and metadata (v2)
 */
export async function retrieveFableV2(
  fableId: string,
  version?: number,
): Promise<FableRetrieveV2Response> {
  const params: Record<string, string | number> = {
    fable_builder_id: fableId,
  }
  if (version !== undefined) {
    params.version = version
  }
  return apiClient.get(API_ENDPOINTS.fable.retrieveV2, {
    params,
    schema: FableRetrieveV2ResponseSchema,
  })
}

/**
 * Create or update a fable with full metadata, returning { id, version } (v2)
 */
export async function upsertFableV2(
  request: FableUpsertV2Request,
): Promise<FableUpsertV2Response> {
  return apiClient.post(API_ENDPOINTS.fable.upsertV2, request, {
    schema: FableUpsertV2ResponseSchema,
  })
}

/**
 * Compile a fable by persisted definition reference (v2)
 */
export async function compileFableV2(
  request: FableCompileV2Request,
): Promise<ExecutionSpecification> {
  return apiClient.put(API_ENDPOINTS.fable.compileV2, request)
}
