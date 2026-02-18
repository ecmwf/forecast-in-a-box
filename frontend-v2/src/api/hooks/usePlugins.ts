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
  PluginsStatus,
} from '@/api/types/plugins.types'
import {
  disablePlugin,
  enablePlugin,
  getPluginDetails,
  getPluginStatus,
  installPlugin,
  modifyPluginEnabled,
  uninstallPlugin,
  updatePlugin,
} from '@/api/endpoints/plugins'
import { toPluginInfoList } from '@/api/types/plugins.types'
import { fableKeys } from '@/api/hooks/useFable'

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
  const { data: listing, ...rest } = usePluginDetails()

  const plugins = useMemo<Array<PluginInfo>>(() => {
    if (!listing) return []

    const capabilitiesMap = deriveCapabilitiesFromCatalogue(catalogue)
    return toPluginInfoList(listing, capabilitiesMap)
  }, [listing, catalogue])

  return {
    ...rest,
    data: listing ? { plugins } : undefined,
    plugins,
  }
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
      // Sequential on purpose: the catalogue endpoint returns 503 while plugins
      // reload after an install/uninstall/update. Waiting for the catalogue to
      // succeed (via retry) ensures plugins are fully loaded before we refetch
      // details, so the UI sees the updated state. Do NOT parallelize these.
      await queryClient.invalidateQueries({ queryKey: fableKeys.catalogue() })
      await queryClient.invalidateQueries({ queryKey: pluginKeys.details() })
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

export function useModifyPluginEnabled() {
  return usePluginMutation(
    ({
      compositeId,
      isEnabled,
    }: {
      compositeId: PluginCompositeId
      isEnabled: boolean
    }) => modifyPluginEnabled(compositeId, isEnabled),
  )
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
