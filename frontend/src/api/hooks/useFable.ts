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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  BlockFactoryCatalogue,
  BlueprintDeleteRequest,
  BlueprintListResponse,
  FableBuilderV1,
  FableRetrieveResponse,
  FableUpsertResponse,
  FableValidationExpansion,
  GlobalGlyphPostRequest,
  GlobalGlyphResponse,
  GlyphFunctionsResponse,
  GlyphListResponse,
  IntrinsicGlyphItem,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  createGlobalGlyph,
  deleteBlueprint,
  deleteGlobalGlyph,
  expandFable,
  getAvailableGlyphs,
  getCatalogue,
  listBlueprints,
  listGlobalGlyphs,
  listGlyphFunctions,
  retrieveFable,
  updateBlueprint,
  upsertFable,
} from '@/api/endpoints/fable'
import type { BlueprintListFilters } from '@/api/endpoints/fable'
import { getFactory } from '@/api/types/fable.types'
import { ApiClientError } from '@/api/client'
import { QUERY_CONSTANTS } from '@/utils/constants'

export const fableKeys = {
  all: ['fable'] as const,
  catalogue: () => [...fableKeys.all, 'catalogue'] as const,
  // Prefix shared by every paginated blueprint-list query — invalidate to refresh all of them.
  blueprintsBase: () => [...fableKeys.all, 'blueprints'] as const,
  blueprints: (page?: number, pageSize?: number, filters?: object) =>
    [...fableKeys.all, 'blueprints', page, pageSize, filters ?? null] as const,
  detail: (id: string) => [...fableKeys.all, 'detail', id] as const,
  validation: (fable: FableBuilderV1) =>
    [...fableKeys.all, 'validation', JSON.stringify(fable)] as const,
  glyphs: () => [...fableKeys.all, 'glyphs'] as const,
  glyphFunctions: () => [...fableKeys.all, 'glyphFunctions'] as const,
  globalGlyphsBase: () => [...fableKeys.all, 'globalGlyphs'] as const,
  globalGlyphs: (page?: number, pageSize?: number) =>
    [...fableKeys.all, 'globalGlyphs', page, pageSize] as const,
  globalGlyph: (id: string) => [...fableKeys.all, 'globalGlyph', id] as const,
}

export function useBlockCatalogue(language?: string) {
  return useQuery<BlockFactoryCatalogue>({
    queryKey: [...fableKeys.catalogue(), language],
    queryFn: () => getCatalogue(language),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    // Always refetch on mount so a previously-cached error state
    // (e.g. the backend was still loading plugins on first visit) doesn't
    // silently persist until the user hits F5.
    refetchOnMount: 'always',
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

/** Query key shared by useFable and useFableRetrieve — one request per fable. */
const fableRetrieveKey = (fableId: string | null | undefined) =>
  [...fableKeys.detail(fableId ?? ''), 'full'] as const

/** Don't retry 4xx (e.g. 404 not found) — only retry server errors. */
function retryRetrieve(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status && error.status < 500)
    return false
  return failureCount < QUERY_CONSTANTS.RETRY.MINIMAL
}

/**
 * Retrieve a fable's builder. Shares one query (and one network request) with
 * useFableRetrieve via a common query key + `select`.
 */
export function useFable(fableId: string | null | undefined) {
  return useQuery<FableRetrieveResponse, Error, FableBuilderV1>({
    queryKey: fableRetrieveKey(fableId),
    queryFn: () => retrieveFable(fableId!),
    select: (response) => response.builder,
    enabled: !!fableId,
    staleTime: Infinity,
    retry: retryRetrieve,
  })
}

export function useFableRetrieve(fableId: string | null | undefined) {
  return useQuery<FableRetrieveResponse>({
    queryKey: fableRetrieveKey(fableId),
    queryFn: () => retrieveFable(fableId!),
    enabled: !!fableId,
    staleTime: Infinity,
    retry: retryRetrieve,
  })
}

export function useFableValidation(
  fable: FableBuilderV1 | null,
  enabled: boolean = true,
) {
  const stableFable = useMemo(() => fable ?? { blocks: {} }, [fable])

  const hasBlocks = fable !== null && Object.keys(fable.blocks).length > 0

  return useQuery<FableValidationExpansion, Error>({
    queryKey: fableKeys.validation(stableFable),
    queryFn: () => expandFable(stableFable),
    enabled: enabled && hasBlocks,
    staleTime: 10 * 1000, // 10 seconds
    refetchOnWindowFocus: false,
    // Keep previous error state visible while a new validation is in flight.
    // Prevents the right panel and graph nodes from flickering between
    // "errors" and "clean" across keystrokes.
    placeholderData: keepPreviousData,
    // Only retry 503 (plugin reload). 4xx are validation errors (don't retry),
    // and other 5xx (e.g. a backend crash in validate_expand) aren't transient —
    // retrying just spams the server logs without changing the outcome.
    retry: (failureCount, error) => {
      if (!(error instanceof ApiClientError)) return false
      if (error.status !== 503) return false
      return failureCount < QUERY_CONSTANTS.RETRY.ON_503
    },
    retryDelay: QUERY_CONSTANTS.RETRY_DELAY.ON_503,
  })
}

export function useListBlueprints(
  page: number = 1,
  pageSize: number = 50,
  filters?: BlueprintListFilters,
) {
  return useQuery<BlueprintListResponse>({
    queryKey: fableKeys.blueprints(page, pageSize, filters),
    queryFn: () => listBlueprints(page, pageSize, filters),
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
      // Update when we have ID + version. parent_id is re-sent — the
      // backend replaces the metadata row and omitting it wipes lineage.
      if (fableId && fableVersion != null) {
        return updateBlueprint({
          blueprint_id: fableId,
          version: fableVersion,
          builder: fable,
          display_name,
          display_description,
          tags: tags ?? [],
          parent_id: parentId ?? null,
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
        queryKey: fableKeys.blueprintsBase(),
      })
    },
  })
}

export function useDeleteBlueprint() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, BlueprintDeleteRequest>({
    mutationFn: deleteBlueprint,
    onSuccess: () => {
      // Only refresh lists. Invalidating the deleted blueprint's detail
      // would refetch a 404 from still-mounted rows and toast an error;
      // the stale cache entry is unreachable once the lists update.
      queryClient.invalidateQueries({
        queryKey: fableKeys.blueprintsBase(),
      })
    },
  })
}

/**
 * Fetch available intrinsic glyphs for ${glyph} interpolation in block configs.
 * Intrinsic glyphs are static (e.g., runId, submitDatetime), so we cache aggressively.
 */
export function useAvailableGlyphs() {
  return useQuery<Array<IntrinsicGlyphItem>>({
    queryKey: fableKeys.glyphs(),
    queryFn: getAvailableGlyphs,
    staleTime: 30 * 60 * 1000, // 30 minutes — intrinsic glyphs change rarely
    gcTime: 60 * 60 * 1000, // 1 hour
  })
}

/**
 * Fetch the list of custom Jinja filters/globals available in glyph expressions.
 * Static for the lifetime of the backend process, so we cache aggressively.
 */
export function useGlyphFunctions() {
  return useQuery<GlyphFunctionsResponse>({
    queryKey: fableKeys.glyphFunctions(),
    queryFn: listGlyphFunctions,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}

/**
 * List global glyphs (paginated)
 */
export function useListGlobalGlyphs(page: number = 1, pageSize: number = 50) {
  return useQuery<GlyphListResponse>({
    queryKey: fableKeys.globalGlyphs(page, pageSize),
    queryFn: () => listGlobalGlyphs(page, pageSize),
    staleTime: QUERY_CONSTANTS.STALE_TIMES.DEFAULT,
  })
}

/**
 * Create or update a global glyph
 */
export function useCreateGlobalGlyph() {
  const queryClient = useQueryClient()

  return useMutation<GlobalGlyphResponse, Error, GlobalGlyphPostRequest>({
    mutationFn: createGlobalGlyph,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: fableKeys.globalGlyphsBase(),
      })
    },
  })
}

/**
 * Delete a global glyph by ID
 */
export function useDeleteGlobalGlyph() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: deleteGlobalGlyph,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fableKeys.globalGlyphsBase() })
    },
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
