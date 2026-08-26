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
 * Plugin events also toast: they finish as background tasks, silent otherwise.
 */

import i18n from 'i18next'
import type { QueryKey } from '@tanstack/react-query'
import type { ClientNotification } from '@/api/types/notification.types'
import { clientNotificationSchema } from '@/api/types/notification.types'
import { API_PREFIX } from '@/api/endpoints'
import { artifactKeys, wakeDownloadPolling } from '@/api/hooks/useArtifacts'
import { fableKeys } from '@/api/hooks/useFable'
import { pluginKeys } from '@/api/hooks/usePlugins'
import { createLogger } from '@/lib/logger'
import { queryClient } from '@/lib/queryClient'
import { showToast } from '@/lib/toast'

const log = createLogger('Notifications')

/** Normalized backend refresh route -> query keys it makes stale. */
const refreshRouteQueryKeys = new Map<string, ReadonlyArray<QueryKey>>([
  ['artifacts/list_models', [artifactKeys.list()]],
  // Every plugin event ships this route; a change stales all three caches.
  [
    'plugin/list',
    [pluginKeys.list(), fableKeys.catalogue(), fableKeys.blueprintsBase()],
  ],
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

/** Backend ships `store:local`; the UI shows `store/local`. */
function pluginDisplayId(pluginId: string): string {
  const separator = pluginId.indexOf(':')
  return separator === -1
    ? pluginId
    : `${pluginId.slice(0, separator)}/${pluginId.slice(separator + 1)}`
}

/** Plugin mutations take either the id itself or `{ compositeId }`. */
function mutationPluginId(variables: unknown): string | null {
  if (typeof variables !== 'object' || variables === null) return null
  const candidate =
    'compositeId' in variables ? variables.compositeId : variables
  if (typeof candidate !== 'object' || candidate === null) return null
  const { store, local } = candidate as { store?: unknown; local?: unknown }
  return typeof store === 'string' && typeof local === 'string'
    ? `${store}/${local}`
    : null
}

/** True while this tab's own mutation for that plugin is still in flight. */
function trackedHere(displayId: string): boolean {
  return (
    queryClient.isMutating({
      mutationKey: pluginKeys.mutation(),
      predicate: (mutation) =>
        mutationPluginId(mutation.state.variables) === displayId,
    }) > 0
  )
}

/** Success event -> copy key, spelled out because i18next types the key. */
type PluginSuccessCopy =
  | 'plugins:notifications.installed'
  | 'plugins:notifications.updated'
  | 'plugins:notifications.settingsApplied'
  | 'plugins:notifications.unloaded'
  | 'plugins:notifications.uninstalled'

const pluginSuccessCopy = new Map<string, PluginSuccessCopy>([
  ['pluginInstalled', 'plugins:notifications.installed'],
  ['pluginUpdated', 'plugins:notifications.updated'],
  ['pluginSettingsApplied', 'plugins:notifications.settingsApplied'],
  ['pluginUnloaded', 'plugins:notifications.unloaded'],
  ['pluginUninstalled', 'plugins:notifications.uninstalled'],
])

/** Toast a plugin event unless this tab started it. Failures always toast:
 *  the route only submits, so the mutation resolves even when the task fails. */
function toastPluginNotification(notification: ClientNotification): void {
  if (notification.sourceDomainEvent === 'pluginGlobalError') {
    const { trigger, error } = notification.context
    showToast.error(
      typeof trigger === 'string'
        ? i18n.t('plugins:notifications.globalError', { trigger })
        : i18n.t('plugins:notifications.globalErrorGeneric'),
      typeof error === 'string' ? error : undefined,
    )
    return
  }

  const copyKey = pluginSuccessCopy.get(notification.sourceDomainEvent)
  if (!copyKey) return

  const pluginId = notification.context.plugin_id
  if (typeof pluginId !== 'string') {
    log.warn('Plugin notification without plugin_id', {
      event: notification.sourceDomainEvent,
    })
    return
  }

  const displayId = pluginDisplayId(pluginId)
  if (trackedHere(displayId)) return
  showToast.success(i18n.t(copyKey, { plugin: displayId }))
}

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

  if (notification.sourceDomainName === 'plugin') {
    toastPluginNotification(notification)
  }
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
