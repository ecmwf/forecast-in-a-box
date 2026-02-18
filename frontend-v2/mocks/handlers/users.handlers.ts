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
 * MSW Handlers for Users API
 */

import { HttpResponse, delay, http } from 'msw'
import { mockCurrentUser } from '../data/users.data'
import type { User } from '@/types/user.types'
import { API_ENDPOINTS } from '@/api/endpoints'

export const usersHandlers = [
  /**
   * GET /api/v1/users/me - Get current user
   *
   * Returns user based on authentication:
   * - If X-Anonymous-ID header present: returns anonymous user
   * - Otherwise: returns mock authenticated user
   */
  http.get(API_ENDPOINTS.users.me, async ({ request }) => {
    await delay(100)

    const anonymousId = request.headers.get('X-Anonymous-ID')

    if (anonymousId) {
      // Return anonymous user based on the anonymous ID
      // Anonymous users are admins (is_superuser: true)
      const anonymousUser: User = {
        id: anonymousId,
        email: `anonymous-${anonymousId.slice(0, 8)}@fiab.local`,
        is_active: true,
        is_superuser: true,
        is_verified: false,
      }
      return HttpResponse.json(anonymousUser)
    }

    // Return authenticated user
    return HttpResponse.json(mockCurrentUser)
  }),
]
