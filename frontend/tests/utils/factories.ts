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
 * Test Data Factories
 *
 * Factory functions for creating test data with sensible defaults.
 * Use these instead of hardcoding test data to:
 * - Ensure consistent, valid test data across tests
 * - Make tests more readable by focusing on relevant overrides
 * - Reduce duplication and maintenance burden
 *
 * Usage:
 * ```typescript
 * import { getMockConfig, getMockUser } from '@tests/utils/factories'
 *
 * const config = getMockConfig({ language_iso639_1: 'de' })
 * const adminUser = getMockUser({ is_superuser: true })
 * ```
 */

import type { AppConfig, AuthType } from '@/types/config.types'

/**
 * Create a mock AppConfig with sensible defaults
 */
export function getMockConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    language_iso639_1: 'en',
    authType: 'anonymous',
    loginEndpoint: null,
    ...overrides,
  }
}

/**
 * Create a mock authenticated AppConfig
 */
export function getMockAuthenticatedConfig(
  overrides?: Partial<AppConfig>,
): AppConfig {
  return getMockConfig({
    authType: 'authenticated' as AuthType,
    loginEndpoint: '/api/v1/auth/login',
    ...overrides,
  })
}

/**
 * User data from the backend
 */
export interface MockUser {
  id: string
  username: string
  email: string
  is_superuser: boolean
  is_active: boolean
}

/**
 * Create a mock User with sensible defaults
 */
export function getMockUser(overrides?: Partial<MockUser>): MockUser {
  return {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    is_superuser: false,
    is_active: true,
    ...overrides,
  }
}

/**
 * Create a mock admin User
 */
export function getMockAdminUser(overrides?: Partial<MockUser>): MockUser {
  return getMockUser({
    id: 'admin-456',
    username: 'admin',
    email: 'admin@example.com',
    is_superuser: true,
    ...overrides,
  })
}

/**
 * SSE Event mock
 */
export interface MockSSEEvent {
  type: string
  data: string
}

/**
 * Create a mock SSE MessageEvent
 */
export function getMockMessageEvent(
  data: unknown,
  type = 'message',
): MessageEvent {
  return new MessageEvent(type, {
    data: typeof data === 'string' ? data : JSON.stringify(data),
  })
}

/**
 * Create a mock progress SSE event
 */
export function getMockProgressEvent(progress: number): MessageEvent {
  return getMockMessageEvent({ type: 'progress', value: progress }, 'progress')
}
