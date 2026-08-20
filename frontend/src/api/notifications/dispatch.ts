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
 * ClientNotification dispatch
 *
 * Notifications are cache-invalidation hints, never state: refreshRoutes
 * map to query keys, server state keeps flowing through TanStack Query, so
 * a missed notification is a slower update, not data loss. Unknown routes
 * only log — each new backend producer costs one registry line.
 */

import type { QueryKey } from '@tanstack/react-query'
import type { ClientNotification } from '@/api/types/notification.types'
import { clientNotificationSchema } from '@/api/types/notification.types'
import { API_PREFIX } from '@/api/endpoints'
import { artifactKeys, wakeDownloadPolling } from '@/api/hooks/useArtifacts'
import { pluginKeys } from '@/api/hooks/usePlugins'
import { createLogger } from '@/lib/logger'
import { queryClient } from '@/lib/queryClient'

const log = createLogger('Notifications')

/** Normalized backend refresh route -> query keys it makes stale. */
const refreshRouteQueryKeys = new Map<string, ReadonlyArray<QueryKey>>([
  ['artifacts/list_models', [artifactKeys.list()]],
  // plugin.pluginGlobalError — the listing's 60s staleTime would hide it.
  ['plugin/list', [pluginKeys.list()]],
])

/** Routes arrive as "api/v1/artifacts/list_models", with or without a leading slash. */
export function normalizeRefreshRoute(route: string): string {
  const unslashed = route.startsWith('/') ? route.slice(1) : route
  const prefix = `${API_PREFIX.slice(1)}/`
  return unslashed.startsWith(prefix)
    ? unslashed.slice(prefix.length)
    : unslashed
}

/** Enrichment by `domain:event` — accelerative only, never load-bearing. */
const domainHandlers = new Map<
  string,
  (notification: ClientNotification) => void
>([
  [
    'artifact:artifactDownloadFinished',
    (notification) => {
      const { artifact_store_id, artifact_local_id } = notification.context
      if (
        typeof artifact_store_id !== 'string' ||
        typeof artifact_local_id !== 'string'
      ) {
        log.warn('artifactDownloadFinished without artifact ids', {
          context: notification.context,
        })
        return
      }
      // Nudge the in-flight poll; its response stays the source of truth
      wakeDownloadPolling({ artifact_store_id, artifact_local_id })
    },
  ],
])

export function dispatchClientNotification(
  notification: ClientNotification,
): void {
  for (const route of notification.refreshRoutes) {
    const keys = refreshRouteQueryKeys.get(normalizeRefreshRoute(route))
    if (!keys) {
      log.warn('No query mapping for refresh route', {
        route,
        event: `${notification.sourceDomainName}:${notification.sourceDomainEvent}`,
      })
      continue
    }
    for (const queryKey of keys) {
      queryClient.invalidateQueries({ queryKey })
    }
  }

  domainHandlers.get(
    `${notification.sourceDomainName}:${notification.sourceDomainEvent}`,
  )?.(notification)
}

/** Raw frame -> validated notification -> dispatch; malformed input logs and drops. */
export function handleNotificationSocketMessage(data: unknown): void {
  if (typeof data !== 'string') {
    log.warn('Ignoring non-text notification frame')
    return
  }
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    log.warn('Ignoring unparseable notification frame', { data })
    return
  }
  const parsed = clientNotificationSchema.safeParse(json)
  if (!parsed.success) {
    log.warn('Ignoring malformed notification', {
      issues: parsed.error.issues,
    })
    return
  }
  dispatchClientNotification(parsed.data)
}

/** Invalidate every registered route — reconnects lose gap events (no replay). */
export function resyncRegisteredRoutes(): void {
  for (const keys of refreshRouteQueryKeys.values()) {
    for (const queryKey of keys) {
      queryClient.invalidateQueries({ queryKey })
    }
  }
}
