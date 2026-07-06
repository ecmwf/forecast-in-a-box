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
 * Plugins Hooks
 *
 * TanStack Query hooks for plugin management.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BlockFactoryCatalogue, BlockKind } from '@/api/types/fable.types'
import type {
  PluginCapability,
  PluginCompositeId,
  PluginInfo,
  PluginListing,
  PluginSettingsUpdate,
  PluginsStatus,
} from '@/api/types/plugins.types'
import {
  disablePlugin,
  enablePlugin,
  getPluginDetails,
  getPluginStatus,
  getTemplateExampleValues,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  updatePluginSettings,
} from '@/api/endpoints/plugins'
import { parsePluginIdString } from '@/api/types/plugins.types'
import { getCatalogue } from '@/api/endpoints/fable'
import { toPluginInfoList } from '@/api/types/plugins.types'
import { fableKeys } from '@/api/hooks/useFable'
import { createLogger } from '@/lib/logger'

const log = createLogger('usePlugins')

/** Query keys for plugins */
export const pluginKeys = {
  all: ['plugin'] as const,
  status: () => [...pluginKeys.all, 'status'] as const,
  details: (forceRefresh?: boolean) =>
    [...pluginKeys.all, 'details', { forceRefresh }] as const,
}

/**
 * Hook to get plugin system status
 */
export function usePluginStatus() {
  return useQuery<PluginsStatus>({
    queryKey: pluginKeys.status(),
    queryFn: getPluginStatus,
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Hook to get all plugin details (raw backend response)
 */
export function usePluginDetails(forceRefresh?: boolean) {
  return useQuery<PluginListing>({
    queryKey: pluginKeys.details(forceRefresh),
    queryFn: () => getPluginDetails(forceRefresh),
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Derive plugin capabilities from fable catalogue
 *
 * Since the backend doesn't provide capabilities directly,
 * we derive them by looking at the BlockFactory.kind values
 * for each plugin's factories in the catalogue.
 */
export function deriveCapabilitiesFromCatalogue(
  catalogue: BlockFactoryCatalogue | undefined,
): Map<string, Array<PluginCapability>> {
  const capabilitiesMap = new Map<string, Array<PluginCapability>>()

  if (!catalogue) {
    return capabilitiesMap
  }

  for (const [pluginId, pluginCatalogue] of Object.entries(catalogue)) {
    const kinds = new Set<BlockKind>()
    for (const factory of Object.values(pluginCatalogue.factories)) {
      kinds.add(factory.kind)
    }
    // BlockKind values are the same as PluginCapability values
    capabilitiesMap.set(pluginId, Array.from(kinds))
  }

  return capabilitiesMap
}

/**
 * Hook to get all plugins as UI-friendly PluginInfo array
 *
 * This is the main hook used by UI components. It:
 * 1. Fetches plugin details from the backend
 * 2. Optionally cross-references with fable catalogue to derive capabilities
 * 3. Transforms to UI-friendly format
 */
export function usePlugins(catalogue?: BlockFactoryCatalogue) {
  // Forward fields by explicit access, not rest/spread — Query tracks per-field
  // reads, so spreading re-renders on every field.
  const query = usePluginDetails()
  const listing = query.data
  // plugin_enabled lives on a separate endpoint — join it so the toggle
  // reflects real enabled state, not just whether the module loaded.
  const enabledMap = usePluginStatus().data?.plugin_enabled

  const plugins = useMemo<Array<PluginInfo>>(() => {
    if (!listing) return []

    const capabilitiesMap = deriveCapabilitiesFromCatalogue(catalogue)
    return toPluginInfoList(listing, capabilitiesMap, enabledMap)
  }, [listing, catalogue, enabledMap])

  return {
    data: listing ? { plugins } : undefined,
    plugins,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Poll the catalogue endpoint until it stops returning 503.
 *
 * After a plugin install/uninstall/update the backend reloads plugins,
 * which makes the catalogue return 503 for a variable amount of time
 * (depends on plugin size). We poll with a generous timeout rather than
 * relying on TanStack Query's retry budget, which is too small for
 * large plugins.
 */
const CATALOGUE_POLL_INTERVAL_MS = 2000
const CATALOGUE_POLL_TIMEOUT_MS = 60_000

async function waitForCatalogue(): Promise<void> {
  const deadline = Date.now() + CATALOGUE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await getCatalogue()
      return
    } catch {
      log.debug('Catalogue not ready yet, retrying...')
      await new Promise((r) => setTimeout(r, CATALOGUE_POLL_INTERVAL_MS))
    }
  }
  log.warn('Catalogue poll timed out — proceeding with details refresh')
}

/**
 * Create a plugin mutation that waits for catalogue + details to refresh.
 *
 * After any plugin operation the backend reloads plugins, which temporarily
 * makes the catalogue endpoint return 503. The mutation stays pending until
 * the catalogue is available again and details are refreshed.
 */
function usePluginMutation<TVariables>(
  action: (variables: TVariables) => Promise<void>,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: TVariables) => {
      await action(variables)
      // Poll until the catalogue is available again (plugins finished reloading)
      await waitForCatalogue()
      // Refresh caches. Status carries plugin_enabled, so it must refresh too
      // or the toggle sticks.
      await queryClient.invalidateQueries({ queryKey: fableKeys.catalogue() })
      await queryClient.invalidateQueries({ queryKey: pluginKeys.details() })
      await queryClient.invalidateQueries({ queryKey: pluginKeys.status() })
    },
  })
}

export function useInstallPlugin() {
  return usePluginMutation(installPlugin)
}

export function useUninstallPlugin() {
  return usePluginMutation(uninstallPlugin)
}

export function useEnablePlugin() {
  return usePluginMutation(enablePlugin)
}

export function useDisablePlugin() {
  return usePluginMutation(disablePlugin)
}

export function useUpdatePlugin() {
  return usePluginMutation(updatePlugin)
}

export function useUpdatePluginSettings() {
  return usePluginMutation(
    ({
      compositeId,
      settings,
    }: {
      compositeId: PluginCompositeId
      settings: PluginSettingsUpdate
    }) => updatePluginSettings(compositeId, settings),
  )
}

/**
 * Example values/glyphs for a blueprint template.
 * @param pluginId - "store:local" composite string (blueprint `created_by` format)
 * @param displayName - The template's display name within the plugin
 */
export function useTemplateExampleValues(
  pluginId: string | undefined,
  displayName: string | undefined,
) {
  return useQuery({
    queryKey: [
      ...pluginKeys.all,
      'templateExampleValues',
      pluginId,
      displayName,
    ],
    queryFn: () =>
      getTemplateExampleValues(parsePluginIdString(pluginId!), displayName!),
    enabled: !!pluginId && !!displayName,
    staleTime: Infinity,
    // 403 (excluded) / 404 (plugin unloaded) are terminal — don't retry
    retry: false,
  })
}

/**
 * Hook to refresh plugin details (force refresh from backend)
 */
export function useRefreshPlugins() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => getPluginDetails(true),
    onSuccess: (data) => {
      queryClient.setQueryData(pluginKeys.details(), data)
    },
  })
}
