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
 * Sources API Hooks
 *
 * TanStack Query hooks for sources and registries management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type {
  AddRegistryRequest,
  SourceInfo,
  SourceRegistry,
  SourcesApiResponse,
} from '@/api/types/sources.types'
import {
  sourceInfoSchema,
  sourceRegistrySchema,
  sourcesApiResponseSchema,
} from '@/api/types/sources.types'
import { API_ENDPOINTS } from '@/api/endpoints'
import { apiClient } from '@/api/client'

/**
 * Query key factory for sources
 */
export const sourcesKeys = {
  all: ['sources'] as const,
  lists: () => [...sourcesKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...sourcesKeys.lists(), filters] as const,
  details: () => [...sourcesKeys.all, 'detail'] as const,
  detail: (id: string) => [...sourcesKeys.details(), id] as const,
}

/**
 * Query key factory for registries
 */
export const registriesKeys = {
  all: ['registries'] as const,
  lists: () => [...registriesKeys.all, 'list'] as const,
  list: () => [...registriesKeys.lists()] as const,
  details: () => [...registriesKeys.all, 'detail'] as const,
  detail: (id: string) => [...registriesKeys.details(), id] as const,
}

/**
 * Fetch all sources and registries
 */
export function useSources() {
  return useQuery({
    queryKey: sourcesKeys.list(),
    queryFn: async () => {
      const response = await apiClient.get<SourcesApiResponse>(
        API_ENDPOINTS.sources.list,
        { schema: sourcesApiResponseSchema },
      )
      return response
    },
  })
}

/**
 * Fetch a single source by ID
 */
export function useSource(sourceId: string) {
  return useQuery({
    queryKey: sourcesKeys.detail(sourceId),
    queryFn: async () => {
      const response = await apiClient.get<{ source: SourceInfo }>(
        API_ENDPOINTS.sources.byId(sourceId),
        { schema: z.object({ source: sourceInfoSchema }) },
      )
      return response.source
    },
    enabled: Boolean(sourceId),
  })
}

/**
 * Download a source (for model type)
 */
export function useDownloadSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await apiClient.post<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.sources.download(sourceId))
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
    },
  })
}

/**
 * Enable a source
 */
export function useEnableSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await apiClient.put<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.sources.enable(sourceId))
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
    },
  })
}

/**
 * Disable a source
 */
export function useDisableSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await apiClient.put<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.sources.disable(sourceId))
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
    },
  })
}

/**
 * Configure a source
 */
export function useConfigureSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sourceId,
      configurationValues,
    }: {
      sourceId: string
      configurationValues: Record<string, string>
    }) => {
      const response = await apiClient.put<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.sources.configure(sourceId), { configurationValues })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
    },
  })
}

/**
 * Remove a source
 */
export function useRemoveSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await apiClient.delete<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.sources.byId(sourceId))
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
    },
  })
}

/**
 * Toggle source enabled state
 */
export function useToggleSourceEnabled() {
  const enableMutation = useEnableSource()
  const disableMutation = useDisableSource()

  return {
    mutate: (sourceId: string, enabled: boolean) => {
      if (enabled) {
        enableMutation.mutate(sourceId)
      } else {
        disableMutation.mutate(sourceId)
      }
    },
    isPending: enableMutation.isPending || disableMutation.isPending,
  }
}

// ============================================
// Registry Hooks
// ============================================

/**
 * Add a new registry
 */
export function useAddRegistry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: AddRegistryRequest) => {
      const addRegistryResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
        registry: sourceRegistrySchema,
      })
      const response = await apiClient.post<{
        success: boolean
        message: string
        registry: SourceRegistry
      }>(API_ENDPOINTS.registries.add, data, {
        schema: addRegistryResponseSchema,
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
      queryClient.invalidateQueries({ queryKey: registriesKeys.all })
    },
  })
}

/**
 * Remove a registry
 */
export function useRemoveRegistry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (registryId: string) => {
      const response = await apiClient.delete<{
        success: boolean
        message: string
      }>(API_ENDPOINTS.registries.remove(registryId))
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
      queryClient.invalidateQueries({ queryKey: registriesKeys.all })
    },
  })
}

/**
 * Sync a registry
 */
export function useSyncRegistry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (registryId: string) => {
      const syncRegistryResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
        lastSyncedAt: z.string(),
      })
      const response = await apiClient.post<{
        success: boolean
        message: string
        lastSyncedAt: string
      }>(API_ENDPOINTS.registries.sync(registryId), undefined, {
        schema: syncRegistryResponseSchema,
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourcesKeys.all })
      queryClient.invalidateQueries({ queryKey: registriesKeys.all })
    },
  })
}
