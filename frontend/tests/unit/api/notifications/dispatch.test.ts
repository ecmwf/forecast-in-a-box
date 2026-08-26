/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { MutationObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Real copy, so the toast assertions read the interpolated English.
import '@/lib/i18n'
import type { MockInstance } from 'vitest'
import type { ClientNotification } from '@/api/types/notification.types'
import {
  dispatchClientNotification,
  handleNotificationSocketMessage,
  normalizeRefreshRoute,
  resyncRegisteredRoutes,
} from '@/api/notifications/dispatch'
import { artifactKeys, wakeDownloadPolling } from '@/api/hooks/useArtifacts'
import { fableKeys } from '@/api/hooks/useFable'
import { pluginKeys } from '@/api/hooks/usePlugins'
import { queryClient } from '@/lib/queryClient'
import { showToast } from '@/lib/toast'

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

function pluginNotification(
  event: string,
  context: Record<string, unknown> = { plugin_id: 'ecmwf:toy1' },
): ClientNotification {
  return notification({
    text: `Plugin ecmwf:toy1 ${event}`,
    sourceDomainName: 'plugin',
    sourceDomainEvent: event,
    context,
    detailRoute: 'api/v1/plugin/list',
    refreshRoutes: ['api/v1/plugin/list'],
  })
}

/** Real in-flight plugin mutation; returns a settler to release it. */
function startPluginMutation(variables: unknown): () => void {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const observer = new MutationObserver<void, Error, unknown>(queryClient, {
    mutationKey: pluginKeys.mutation(),
    mutationFn: () => gate,
  })
  void observer.mutate(variables)
  return release
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
      pluginNotification('pluginGlobalError', {
        trigger: 'Initial plugin load',
        error: 'broken',
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pluginKeys.list(),
    })
  })

  // The listing alone would leave the builder's catalogue stale.
  it.each([
    ['the block catalogue', () => fableKeys.catalogue()],
    ['the blueprint listing', () => fableKeys.blueprintsBase()],
  ])('also invalidates %s on a plugin event', (_label, queryKey) => {
    dispatchClientNotification(pluginNotification('pluginInstalled'))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKey() })
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

describe('passive plugin toasts', () => {
  let successSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    successSpy = vi.spyOn(showToast, 'success').mockReturnValue('')
    errorSpy = vi.spyOn(showToast, 'error').mockReturnValue('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    queryClient.getMutationCache().clear()
  })

  it.each([
    'pluginInstalled',
    'pluginUpdated',
    'pluginSettingsApplied',
    'pluginUnloaded',
    'pluginUninstalled',
  ])('toasts %s when this tab did not start it', (event) => {
    dispatchClientNotification(pluginNotification(event))
    expect(successSpy).toHaveBeenCalledTimes(1)
  })

  it('renders the plugin id as store/local', () => {
    dispatchClientNotification(pluginNotification('pluginInstalled'))
    expect(successSpy.mock.calls[0][0]).toContain('ecmwf/toy1')
  })

  it('stays silent in the tab that started the operation', () => {
    const release = startPluginMutation({ store: 'ecmwf', local: 'toy1' })
    dispatchClientNotification(pluginNotification('pluginInstalled'))
    expect(successSpy).not.toHaveBeenCalled()
    release()
  })

  // Toggles create no activity task — what broke the first suppression.
  it('stays silent for a toggle this tab started', () => {
    const release = startPluginMutation({ store: 'ecmwf', local: 'toy1' })
    dispatchClientNotification(pluginNotification('pluginUnloaded'))
    expect(successSpy).not.toHaveBeenCalled()
    release()
  })

  it('stays silent for a settings update, whose variables are wrapped', () => {
    const release = startPluginMutation({
      compositeId: { store: 'ecmwf', local: 'toy1' },
      settings: { isEnabled: true },
    })
    dispatchClientNotification(pluginNotification('pluginSettingsApplied'))
    expect(successSpy).not.toHaveBeenCalled()
    release()
  })

  it('still toasts while an unrelated plugin op runs here', () => {
    const release = startPluginMutation({ store: 'ecmwf', local: 'other' })
    dispatchClientNotification(pluginNotification('pluginInstalled'))
    expect(successSpy).toHaveBeenCalledTimes(1)
    release()
  })

  // The route only submits, so the mutation resolves even on failure.
  it('toasts a global error even in the initiating tab', () => {
    const release = startPluginMutation({ store: 'ecmwf', local: 'toy1' })
    dispatchClientNotification(
      pluginNotification('pluginGlobalError', {
        trigger: 'Update of plugin ecmwf:toy1',
        error: 'boom',
      }),
    )
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][1]).toBe('boom')
    release()
  })

  it('skips a success event whose context lacks plugin_id', () => {
    dispatchClientNotification(pluginNotification('pluginInstalled', {}))
    expect(successSpy).not.toHaveBeenCalled()
  })

  it('leaves non-plugin domains untoasted', () => {
    dispatchClientNotification(notification())
    expect(successSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
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
