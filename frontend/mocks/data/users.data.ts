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
 * Mock User Data
 *
 * Matches FastAPI-Users user model schema.
 */

import type { User } from '@/types/user.types'

export const mockCurrentUser: User = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  email: 'demo.user@ecmwf.int',
  is_active: true,
  is_superuser: false,
  is_verified: true,
}

export const mockAdminUser: User = {
  id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
  email: 'admin@ecmwf.int',
  is_active: true,
  is_superuser: true,
  is_verified: true,
}
