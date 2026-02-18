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
 * MSW Handlers for Auth API
 */

import { HttpResponse, delay, http } from 'msw'
import { API_ENDPOINTS } from '@/api/endpoints'

export const authHandlers = [
  /**
   * POST /api/v1/auth/logout - Logout current session
   */
  http.post(API_ENDPOINTS.auth.logout, async () => {
    await delay(200)
    return new HttpResponse(null, { status: 200 })
  }),
]
