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
 * Runs the real transport against the MSW WebSocket mock: proves the link
 * pattern intercepts the app's URL (a mismatch silently bypasses MSW) and
 * that a broadcast flows through parse -> dispatch -> invalidation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastClientNotification } from '../../../mocks/handlers/notification.handlers'
import { artifactKeys } from '@/api/hooks/useArtifacts'
import {
  acquireNotificationSocket,
  resetNotificationSocketForTests,
} from '@/api/notifications/socket'
import { queryClient } from '@/lib/queryClient'
import { useNotificationStore } from '@/stores/notificationStore'

describe('notification socket against the MSW mock', () => {
  afterEach(() => {
    resetNotificationSocketForTests()
    vi.restoreAllMocks()
  })

  it('connects through the mock and dispatches broadcast notifications', async () => {
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()

    acquireNotificationSocket()
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().status).toBe('connected')
    })

    broadcastClientNotification({
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
    })

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: artifactKeys.list(),
      })
    })
  })
})
