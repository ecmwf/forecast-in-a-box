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
 * Status API Endpoints
 *
 * API functions for system status checks.
 */

import type { StatusResponse } from '@/types/status.types'
import { API_ENDPOINTS } from '@/api/endpoints'
import { statusResponseSchema } from '@/types/status.types'
import { apiClient } from '@/api/client'

/**
 * Fetch system status from the API
 * GET /api/v1/status
 *
 * Response is validated at runtime using Zod to ensure type safety
 */
export async function fetchStatus(): Promise<StatusResponse> {
  return apiClient.get<StatusResponse>(API_ENDPOINTS.status, {
    schema: statusResponseSchema,
  })
}
