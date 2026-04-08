/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BlockFactoryCatalogue,
  BlueprintDeleteRequest,
  BlueprintListResponse,
  FableBuilderV1,
  FableRetrieveResponse,
  FableUpsertResponse,
  FableValidationExpansion,
  PluginBlockFactoryId,
  VariableDetail,
} from '@/api/types/fable.types'
import {
  deleteBlueprint,
  expandFable,
  getAvailableVariables,
  getCatalogue,
  listBlueprints,
  retrieveFable,
  updateBlueprint,
  upsertFable,
} from '@/api/endpoints/fable'
import { getFactory } from '@/api/types/fable.types'
import { ApiClientError } from '@/api/client'
import { QUERY_CONSTANTS } from '@/utils/constants'

export const fableKeys = {
  all: ['fable'] as const,
  catalogue: () => [...fableKeys.all, 'catalogue'] as const,
  blueprints: (page?: number, pageSize?: number) =>
    [...fableKeys.all, 'blueprints', page, pageSize] as const,
  detail: (id: string) => [...fableKeys.all, 'detail', id] as const,
  validation: (fable: FableBuilderV1) =>
    [...fableKeys.all, 'validation', JSON.stringify(fable)] as const,
  variables: () => [...fableKeys.all, 'variables'] as const,
}

export function useBlockCatalogue(language?: string) {
  return useQuery<BlockFactoryCatalogue>({
    queryKey: [...fableKeys.catalogue(), language],
    queryFn: () => getCatalogue(language),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: (failureCount, error) => {
      // Retry more on 503 (plugins temporarily unavailable after install/update)
      if (error instanceof ApiClientError && error.status === 503) {
        return failureCount < QUERY_CONSTANTS.RETRY.AGGRESSIVE
      }
      return failureCount < QUERY_CONSTANTS.RETRY.DEFAULT
    },
    retryDelay: (attemptIndex, error) => {
      // Use fixed 1s delay for 503 since we just need to wait for plugins to load
      if (error instanceof ApiClientError && error.status === 503) {
        return 1000
      }
      return Math.min(1000 * 2 ** attemptIndex, 30000)
    },
  })
}

export function useFable(fableId: string | null | undefined) {
  return useQuery<FableBuilderV1>({
    queryKey: fableKeys.detail(fableId ?? ''),
    queryFn: async () => {
      const response = await retrieveFable(fableId!)
      return response.builder
    },
    enabled: !!fableId,
    staleTime: 30 * 1000, // 30 seconds
    // Don't retry 4xx errors (e.g. 404 not found) — only retry server errors
    retry: (failureCount, error) => {
      if (error instanceof ApiClientError && error.status && error.status < 500)
        return false
      return failureCount < QUERY_CONSTANTS.RETRY.MINIMAL
    },
  })
}

export function useFableRetrieve(fableId: string | null | undefined) {
  return useQuery<FableRetrieveResponse>({
    queryKey: [...fableKeys.detail(fableId ?? ''), 'full'],
    queryFn: () => retrieveFable(fableId!),
    enabled: !!fableId,
    staleTime: Infinity,
    // Don't retry 4xx errors (e.g. 404 not found) — only retry server errors
    retry: (failureCount, error) => {
      if (error instanceof ApiClientError && error.status && error.status < 500)
        return false
      return failureCount < QUERY_CONSTANTS.RETRY.MINIMAL
    },
  })
}

export function useExpandFable() {
  return useMutation<FableValidationExpansion, Error, FableBuilderV1>({
    mutationFn: expandFable,
  })
}

export function useFableValidation(
  fable: FableBuilderV1 | null,
  enabled: boolean = true,
) {
  const stableFable = useMemo(
    () => fable ?? ({ blocks: {} } as FableBuilderV1),
    [fable],
  )

  const hasBlocks = fable !== null && Object.keys(fable.blocks).length > 0

  return useQuery<FableValidationExpansion, Error>({
    queryKey: fableKeys.validation(stableFable),
    queryFn: () => expandFable(stableFable),
    enabled: enabled && hasBlocks,
    staleTime: 10 * 1000, // 10 seconds
    refetchOnWindowFocus: false,
    // Retry server errors (503 during plugin reload) but not validation errors (4xx)
    retry: (failureCount, error) => {
      if (error instanceof ApiClientError && error.status && error.status < 500)
        return false
      return failureCount < QUERY_CONSTANTS.RETRY.ON_503
    },
    retryDelay: QUERY_CONSTANTS.RETRY_DELAY.ON_503,
  })
}

export function useListBlueprints(page: number = 1, pageSize: number = 50) {
  return useQuery<BlueprintListResponse>({
    queryKey: fableKeys.blueprints(page, pageSize),
    queryFn: () => listBlueprints(page, pageSize),
    staleTime: QUERY_CONSTANTS.STALE_TIMES.DEFAULT,
  })
}

export function useUpsertFable() {
  const queryClient = useQueryClient()

  return useMutation<
    FableUpsertResponse,
    Error,
    {
      fable: FableBuilderV1
      fableId?: string
      fableVersion?: number
      parentId?: string
      display_name: string
      display_description: string
      tags?: Array<string>
    }
  >({
    mutationFn: ({
      fable,
      fableId,
      fableVersion,
      parentId,
      display_name,
      display_description,
      tags,
    }) => {
      // Update existing blueprint when we have both ID and version
      if (fableId && fableVersion != null) {
        return updateBlueprint({
          blueprint_id: fableId,
          version: fableVersion,
          builder: fable,
          display_name,
          display_description,
          tags: tags ?? [],
        })
      }
      // Create new blueprint (parentId tracks "forked from" lineage)
      return upsertFable({
        builder: fable,
        display_name,
        display_description,
        tags: tags ?? [],
        parent_id: parentId,
      })
    },
    onSuccess: (result, variables) => {
      if (variables.fableId) {
        queryClient.invalidateQueries({
          queryKey: fableKeys.detail(variables.fableId),
        })
      }
      queryClient.invalidateQueries({
        queryKey: fableKeys.detail(result.blueprint_id),
      })
      queryClient.invalidateQueries({
        queryKey: fableKeys.blueprints(),
      })
    },
  })
}

export function useDeleteBlueprint() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, BlueprintDeleteRequest>({
    mutationFn: deleteBlueprint,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: fableKeys.detail(variables.blueprint_id),
      })
      queryClient.invalidateQueries({
        queryKey: fableKeys.blueprints(),
      })
    },
  })
}

/**
 * Fetch available automatic variables for ${variable} interpolation in block configs.
 * Variables are static (e.g., runId, submitDatetime), so we cache aggressively.
 */
export function useAvailableVariables() {
  return useQuery<Array<VariableDetail>>({
    queryKey: fableKeys.variables(),
    queryFn: getAvailableVariables,
    staleTime: 30 * 60 * 1000, // 30 minutes — variables change rarely
    gcTime: 60 * 60 * 1000, // 1 hour
  })
}

export function useBlockFactory(
  factoryId: PluginBlockFactoryId | null | undefined,
) {
  const { data: catalogue, isLoading, error } = useBlockCatalogue()

  const factory =
    factoryId && catalogue ? getFactory(catalogue, factoryId) : undefined

  return {
    factory,
    isLoading,
    error,
    notFound: !isLoading && factoryId && !factory,
  }
}
