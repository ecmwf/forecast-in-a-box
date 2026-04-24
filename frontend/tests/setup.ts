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
import { resetJobsState } from '../mocks/data/job.data'
import { resetArtifactsHandlerState } from '../mocks/handlers/artifacts.handlers'
import { resetFableHandlerState } from '../mocks/handlers/fable.handlers'
import { resetPluginsHandlerState } from '../mocks/handlers/plugins.handlers'
import { useActivityStore } from '@/stores/activityStore'
import { useCommandStore } from '@/stores/commandStore'
import { useConfigStore } from '@/stores/configStore'
import { useUiStore } from '@/stores/uiStore'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useStatusStore } from '@/features/status/stores/statusStore'

// Start MSW browser worker before all tests
beforeAll(async () => {
  await worker.start({
    onUnhandledRequest: 'error',
    quiet: true,
  })
})

/**
 * Global teardown between tests.
 *
 * Without this, module-scoped state in MSW handlers (fable ID counter,
 * saved-fables record, plugin 503 queue, download progress map, job ID
 * counter) and long-lived zustand stores persist across tests, turning
 * order-sensitive assertions into sporadic flakes. The known case:
 * `save-and-load.test.tsx > "handles retrieve error by showing error
 * message"` asserted `state.fableId === null` but saw `'fable-101'`
 * from an earlier test's save mutation.
 */
afterEach(() => {
  worker.resetHandlers()

  // MSW handler-scoped mutable state
  resetFableHandlerState()
  resetPluginsHandlerState()
  resetArtifactsHandlerState()
  resetJobsState()

  // Zustand stores that tests write to
  useFableBuilderStore.getState().reset()
  useCommandStore.getState().reset()
  useUiStore.getState().reset()
  useStatusStore.getState().reset()
  useConfigStore.getState().resetConfig()
  useActivityStore.getState().clearAll()

  // localStorage carries both the persisted UI-preferences slice and any
  // fable-builder draft written by `useDraftPersistence`. Test files that
  // previously called `localStorage.clear()` in their own beforeEach can
  // now drop that boilerplate.
  localStorage.clear()
})

// Stop the worker after all tests complete
afterAll(() => {
  worker.stop()
})
