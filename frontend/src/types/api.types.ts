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
 * Base API types for the FIAB application
 */

import type { z } from 'zod'

/** Shape of a JSON error body returned by the backend. */
export interface ApiError {
  message: string
  code?: string
  status?: number
  details?: unknown
}

/** HTTP methods accepted by the API client. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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
