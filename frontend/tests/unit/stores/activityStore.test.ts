/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { rewriteLegacyRoute, useActivityStore } from '@/stores/activityStore'

describe('rewriteLegacyRoute', () => {
  it('maps renamed route prefixes onto the live routes', () => {
    expect(rewriteLegacyRoute('/executions/abc-123')).toBe('/execute/abc-123')
    expect(rewriteLegacyRoute('/executions')).toBe('/execute')
    expect(rewriteLegacyRoute('/runs/abc-123')).toBe('/execute/abc-123')
    expect(rewriteLegacyRoute('/dashboard')).toBe('/overview')
  })

  it('leaves live and unrelated paths untouched', () => {
    expect(rewriteLegacyRoute('/execute/abc-123')).toBe('/execute/abc-123')
    expect(rewriteLegacyRoute('/visualise')).toBe('/visualise')
    // Prefix match only at a path-segment boundary.
    expect(rewriteLegacyRoute('/dashboard-v2')).toBe('/dashboard-v2')
  })
})

describe('activity store v1 → v2 migration', () => {
  it('rewrites persisted notification links onto the renamed routes', async () => {
    localStorage.setItem(
      STORAGE_KEYS.stores.activity,
      JSON.stringify({
        state: {
          tasks: {
            'job:1': {
              id: 'job:1',
              type: 'job',
              label: 'Forecast run',
              description: 'done',
              status: 'completed',
              startedAt: 1,
              completedAt: 2,
              navigateTo: '/executions/abc-123',
            },
            'plugin:1': {
              id: 'plugin:1',
              type: 'plugin',
              label: 'Plugin install',
              description: 'done',
              status: 'completed',
              startedAt: 1,
              completedAt: 2,
            },
          },
        },
        version: 1,
      }),
    )
    await useActivityStore.persist.rehydrate()
    const tasks = useActivityStore.getState().tasks
    expect(tasks['job:1']?.navigateTo).toBe('/execute/abc-123')
    // Records without a link survive unchanged.
    expect(tasks['plugin:1']?.label).toBe('Plugin install')
    expect(tasks['plugin:1']?.navigateTo).toBeUndefined()
  })
})
