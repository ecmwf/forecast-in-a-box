/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { ClientNotification } from '@/api/types/notification.types'
import {
  dispatchClientNotification,
  handleNotificationSocketMessage,
  normalizeRefreshRoute,
  resyncRegisteredRoutes,
} from '@/api/notifications/dispatch'
import { artifactKeys, wakeDownloadPolling } from '@/api/hooks/useArtifacts'
import { pluginKeys } from '@/api/hooks/usePlugins'
import { queryClient } from '@/lib/queryClient'

vi.mock('@/api/hooks/useArtifacts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, wakeDownloadPolling: vi.fn() }
})

// Wipe the module-mock's call history, which restoreAllMocks leaves alone
beforeEach(() => {
  vi.clearAllMocks()
})

function notification(
  overrides: Partial<ClientNotification> = {},
): ClientNotification {
  return {
    text: 'Artifact model-a finished downloading successfully',
    sourceDomainName: 'artifact',
    sourceDomainEvent: 'artifactDownloadFinished',
    context: {
      artifact_store_id: 'store-1',
      artifact_local_id: 'model-a',
      success: true,
    },
    detailRoute: 'api/v1/artifacts/model_details',
    refreshRoutes: ['api/v1/artifacts/list_models'],
    ...overrides,
  }
}

describe('normalizeRefreshRoute', () => {
  it('strips the api prefix', () => {
    expect(normalizeRefreshRoute('api/v1/artifacts/list_models')).toBe(
      'artifacts/list_models',
    )
  })

  it('tolerates a leading slash', () => {
    expect(normalizeRefreshRoute('/api/v1/artifacts/list_models')).toBe(
      'artifacts/list_models',
    )
  })

  it('passes through already-bare routes', () => {
    expect(normalizeRefreshRoute('artifacts/list_models')).toBe(
      'artifacts/list_models',
    )
  })
})

describe('dispatchClientNotification', () => {
  let invalidateSpy: MockInstance

  beforeEach(() => {
    invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invalidates the queries mapped to each refresh route', () => {
    dispatchClientNotification(notification())
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
  })

  it('invalidates the plugin listing on a plugin global error', () => {
    dispatchClientNotification(
      notification({
        text: 'Initial plugin load failed: environment already broken',
        sourceDomainName: 'plugin',
        sourceDomainEvent: 'pluginGlobalError',
        context: { trigger: 'Initial plugin load', error: 'broken' },
        detailRoute: 'api/v1/plugin/list',
        refreshRoutes: ['api/v1/plugin/list'],
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pluginKeys.list(),
    })
  })

  it('ignores unmapped refresh routes without invalidating', () => {
    dispatchClientNotification(
      notification({ refreshRoutes: ['api/v1/some/unknown_route'] }),
    )
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('wakes the download poll for artifactDownloadFinished', () => {
    dispatchClientNotification(notification())
    expect(wakeDownloadPolling).toHaveBeenCalledWith({
      artifact_store_id: 'store-1',
      artifact_local_id: 'model-a',
    })
  })

  it('skips the wake when the context lacks artifact ids', () => {
    dispatchClientNotification(notification({ context: { success: true } }))
    expect(wakeDownloadPolling).not.toHaveBeenCalled()
  })

  it('runs no domain handler for unknown events', () => {
    dispatchClientNotification(
      notification({ sourceDomainEvent: 'somethingElse' }),
    )
    expect(wakeDownloadPolling).not.toHaveBeenCalled()
    // Generic invalidation still applies
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
  })
})

describe('handleNotificationSocketMessage', () => {
  let invalidateSpy: MockInstance

  beforeEach(() => {
    invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses and dispatches a valid frame', () => {
    handleNotificationSocketMessage(JSON.stringify(notification()))
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
  })

  it.each([
    ['non-text frame', new Blob(['x'])],
    ['unparseable JSON', '{not json'],
    ['schema-invalid object', JSON.stringify({ text: 'only text' })],
  ])('drops a %s without throwing', (_label, frame) => {
    expect(() => handleNotificationSocketMessage(frame)).not.toThrow()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('resyncRegisteredRoutes', () => {
  it('invalidates every registered route', () => {
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()
    resyncRegisteredRoutes()
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
    vi.restoreAllMocks()
  })
})
