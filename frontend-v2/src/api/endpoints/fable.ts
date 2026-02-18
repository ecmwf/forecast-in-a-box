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
  FableValidationExpansion,
} from '@/api/types/fable.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  BlockFactoryCatalogueSchema,
  FableBuilderV1Schema,
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
 * Compile a fable configuration
 */
export async function compileFable(fable: FableBuilderV1): Promise<unknown> {
  return apiClient.put(API_ENDPOINTS.fable.compile, fable)
}

/**
 * Retrieve a saved fable by ID
 */
export async function retrieveFable(fableId: string): Promise<FableBuilderV1> {
  return apiClient.get(API_ENDPOINTS.fable.retrieve, {
    params: { fable_builder_id: fableId },
    schema: FableBuilderV1Schema,
  })
}

/**
 * Create or update a fable configuration
 */
export async function upsertFable(
  fable: FableBuilderV1,
  fableId?: string,
  tags: Array<string> = [],
): Promise<string> {
  const params: Record<string, string> = {}

  if (fableId) {
    params.fable_builder_id = fableId
  }

  if (tags.length > 0) {
    params.tags = tags.join(',')
  }

  // Backend expects body wrapped in 'builder' key due to FastAPI parameter naming
  return apiClient.post(
    API_ENDPOINTS.fable.upsert,
    { builder: fable },
    {
      params,
    },
  )
}
