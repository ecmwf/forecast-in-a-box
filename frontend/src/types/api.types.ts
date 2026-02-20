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
 * Base API types and schemas for the FIAB application
 * Uses Zod for runtime validation
 */

import { z } from 'zod'

/**
 * Zod schema for standard API response wrapper
 * Generic - can wrap any data type
 */
export const createApiResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
) =>
  z.object({
    data: dataSchema,
    message: z.string().optional(),
    timestamp: z.string().optional(),
  })

/**
 * Zod schema for API error response
 */
export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  status: z.number().optional(),
  details: z.unknown().optional(),
})

/**
 * Zod schema for HTTP methods
 */
export const httpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

export type ApiError = z.infer<typeof apiErrorSchema>
export type HttpMethod = z.infer<typeof httpMethodSchema>

/**
 * Request configuration (not validated with Zod - internal use only)
 */
export interface RequestConfig {
  method?: HttpMethod
  headers?: Record<string, string>
  body?: unknown
  params?: Record<string, string | number | boolean>
  schema?: z.ZodTypeAny // Optional Zod schema for response validation
}
