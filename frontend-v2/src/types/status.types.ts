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
