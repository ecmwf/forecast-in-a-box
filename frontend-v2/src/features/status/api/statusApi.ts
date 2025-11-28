/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Status API
 * API calls for the status feature with Zod validation
 */

import type { StatusResponse } from '@/types/status.types'
import { statusResponseSchema } from '@/types/status.types'
import { apiClient } from '@/services/apiClient'
import { API_CONSTANTS, buildApiPath } from '@/utils/constants.ts'

/**
 * Fetch system status from the API
 * GET /v1/status
 *
 * Response is validated at runtime using Zod to ensure type safety
 */
export async function fetchStatus(): Promise<StatusResponse> {
  return apiClient.get<StatusResponse>(
    buildApiPath(API_CONSTANTS.ENDPOINTS.STATUS),
    {
      schema: statusResponseSchema,
    },
  )
}
