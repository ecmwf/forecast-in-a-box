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
 * Central export point for all types and schemas
 */

// Export types
export type * from './api.types'
export type * from './status.types'

// Export Zod schemas
export {
  createApiResponseSchema,
  apiErrorSchema,
  httpMethodSchema,
} from './api.types'

export {
  statusValueSchema,
  statusResponseSchema,
  serviceStatusSchema,
} from './status.types'
