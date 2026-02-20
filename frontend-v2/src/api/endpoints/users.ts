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
 * Users API Endpoints
 *
 * API functions for user management operations.
 */

import type { User } from '@/types/user.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { userSchema } from '@/types/user.types'

/**
 * Get current user data
 *
 * Uses session cookie (authenticated mode) or X-Anonymous-ID header (anonymous mode).
 */
export async function getCurrentUser(): Promise<User> {
  return apiClient.get<User>(API_ENDPOINTS.users.me, {
    schema: userSchema,
  })
}
