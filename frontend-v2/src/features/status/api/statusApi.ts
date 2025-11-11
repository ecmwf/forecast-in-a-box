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
