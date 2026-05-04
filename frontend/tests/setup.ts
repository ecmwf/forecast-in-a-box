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

import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { cleanup } from 'vitest-browser-react'
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

/** Reset shared mock + store state. Called from both afterEach and beforeEach
 *  so any async tails from the previous test are wiped _before_ the next
 *  test starts running, which in turn stops `save-and-load > handles
 *  retrieve error` from sporadically seeing a stale `fable-100`/`fable-101`
 *  from an earlier save mutation. */
function resetSharedState(): void {
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
}

/**
 * Global teardown between tests.
 *
 * Explicit DOM cleanup first so any still-mounted component from the
 * previous test can run its unmount effects (clearing setTimeout from
 * `useDraftPersistence`, cancelling in-flight React Query fetches).
 * Then a microtask/macrotask yield so Promise-resolution microtasks and
 * React Query's onSuccess callbacks land before we reset the shared
 * state. Without the yield, a mutation that resolved just as the test
 * body exited could call `markSaved` and set `store.fableId` _after_
 * our reset — re-polluting state for the next test.
 */
afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 0))
  worker.resetHandlers()
  resetSharedState()
})

// Belt-and-braces: a second reset right before each test body runs, so a
// failed afterEach or a module-scoped write from an unrelated file can't
// poison the next test either.
beforeEach(() => {
  resetSharedState()
})

// Stop the worker after all tests complete
afterAll(() => {
  worker.stop()
})
