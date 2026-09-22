/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

describe('tutorialsStore', () => {
  beforeEach(() => {
    useTutorialsStore.getState().reset()
  })

  it('starts pristine: no outcomes, nothing running', () => {
    const state = useTutorialsStore.getState()
    expect(state.statuses).toEqual({})
    expect(state.active).toBeNull()
  })

  it('start begins a run at step 0; setStep moves it', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    expect(useTutorialsStore.getState().active).toEqual({
      id: 'visualise-first-map',
      stepIndex: 0,
    })
    useTutorialsStore.getState().setStep(3)
    expect(useTutorialsStore.getState().active?.stepIndex).toBe(3)
  })

  it('setStep without an active run is a no-op', () => {
    useTutorialsStore.getState().setStep(5)
    expect(useTutorialsStore.getState().active).toBeNull()
  })

  it('finish records the outcome and ends the run', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('completed')
    const state = useTutorialsStore.getState()
    expect(state.active).toBeNull()
    expect(state.statuses['visualise-first-map']).toBe('completed')
  })

  it('finish(null) ends the run without recording an outcome', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish(null)
    const state = useTutorialsStore.getState()
    expect(state.active).toBeNull()
    expect(state.statuses['visualise-first-map']).toBeUndefined()
  })

  it('a later dismissal never downgrades a recorded completion', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('completed')
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('dismissed')
    expect(useTutorialsStore.getState().statuses['visualise-first-map']).toBe(
      'completed',
    )
    expect(useTutorialsStore.getState().active).toBeNull()
  })

  it('a completion replaces an earlier dismissal', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('dismissed')
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('completed')
    expect(useTutorialsStore.getState().statuses['visualise-first-map']).toBe(
      'completed',
    )
  })

  it('persists only statuses — never the running tour', () => {
    useTutorialsStore.getState().start('visualise-first-map')
    useTutorialsStore.getState().finish('completed')
    useTutorialsStore.getState().start('visualise-first-map')

    const raw = localStorage.getItem(STORAGE_KEYS.stores.tutorials)
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw!) as {
      state: Record<string, unknown>
      version: number
    }
    expect(payload.version).toBe(STORE_VERSIONS.tutorials)
    expect(payload.state).toEqual({
      statuses: { 'visualise-first-map': 'completed' },
    })
    expect(payload.state).not.toHaveProperty('active')
  })
})
