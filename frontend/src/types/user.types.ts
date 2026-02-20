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
 * User Types and Schemas
 *
 * User data is fetched from the backend /api/v1/users/me endpoint.
 * The backend is the single source of truth for user identity.
 *
 * This schema matches FastAPI-Users standard user model.
 */

import { z } from 'zod'

/**
 * User Schema (from /api/v1/users/me)
 *
 * Matches FastAPI-Users user model.
 * This is the normalized user object returned by the backend.
 */
export const userSchema = z.object({
  /** User ID (UUID) */
  id: z.string(),

  /** Email address */
  email: z.email(),

  /** Whether the user account is active */
  is_active: z.boolean(),

  /** Whether the user is a superuser (has all permissions) */
  is_superuser: z.boolean(),

  /** Whether the user's email has been verified */
  is_verified: z.boolean(),
})

export type User = z.infer<typeof userSchema>
