/**
 * Status-related types and schemas for the FIAB application
 * Matches the backend API response model
 * Uses Zod for runtime validation
 */

import { z } from 'zod'

/**
 * Zod schema for status values
 * Allows known status values and any other string (for future extensibility)
 */
export const statusValueSchema = z.string()

/**
 * Zod schema for status response from the API
 * GET /api/v1/status
 */
export const statusResponseSchema = z.object({
  api: statusValueSchema,
  cascade: statusValueSchema,
  ecmwf: statusValueSchema,
  scheduler: statusValueSchema,
  version: z.string(),
})

/**
 * Zod schema for individual service status
 */
export const serviceStatusSchema = z.object({
  name: z.string(),
  status: statusValueSchema,
  label: z.string(),
})

/**
 * TypeScript types inferred from Zod schemas
 */
export type StatusValue = z.infer<typeof statusValueSchema>
export type StatusResponse = z.infer<typeof statusResponseSchema>
export type ServiceStatus = z.infer<typeof serviceStatusSchema>
