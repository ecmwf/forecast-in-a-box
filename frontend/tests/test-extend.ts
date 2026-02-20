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
 * Test Extension Module
 *
 * Provides MSW worker access for handler overrides in individual tests.
 *
 * MSW lifecycle (start/stop/reset) is handled globally in setup.ts.
 * This module exports the worker for test-specific handler overrides.
 *
 * Usage for handler overrides:
 *   import { worker } from '@tests/test-extend'
 *   import { http, HttpResponse } from 'msw'
 *
 *   it('handles API error', () => {
 *     worker.use(http.get('/api/endpoint', () => HttpResponse.error()))
 *     // ... test code
 *     // Handler is automatically reset after this test by setup.ts
 *   })
 */

// Export MSW worker for handler overrides in tests
export { worker } from '../mocks/browser'
