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
 * Vitest Browser Mode Test Setup
 *
 * Configures MSW browser worker for API mocking.
 * This file runs before each test file in browser mode.
 *
 * For handler overrides in individual tests, import the worker:
 *   import { worker } from '@tests/test-extend'
 *   worker.use(http.get('/api/endpoint', () => HttpResponse.error()))
 */

import { afterAll, afterEach, beforeAll } from 'vitest'
import { worker } from '../mocks/browser'

// Start MSW browser worker before all tests
beforeAll(async () => {
  await worker.start({
    onUnhandledRequest: 'warn',
    quiet: true,
  })
})

// Reset handlers after each test to ensure isolation
afterEach(() => {
  worker.resetHandlers()
})

// Stop the worker after all tests complete
afterAll(() => {
  worker.stop()
})
