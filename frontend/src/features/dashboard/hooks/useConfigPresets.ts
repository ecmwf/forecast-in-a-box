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
import { useQueries } from '@tanstack/react-query'
import type { BlueprintListItem } from '@/api/types/fable.types'
import { getBlocksByKind } from '@/api/types/fable.types'
import { retrieveFable } from '@/api/endpoints/fable'
import {
  fableKeys,
  useBlockCatalogue,
  useDeleteBlueprint,
  useListBlueprints,
} from '@/api/hooks/useFable'
import i18n from 'i18next'
import { deriveModelLabel, deriveSinkKinds } from '@/features/journal/adapters'
import { showToast } from '@/lib/toast'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { isOneoffBlueprint, stripSystemTags } from '@/lib/system-tags'

/** localStorage only stores favourite flags — everything else comes from the backend */
type FavouritesStore = Record<string, boolean>

export interface PresetEntry {
  blueprintId: string
  displayName: string | null
  displayDescription: string | null
  tags: Array<string>
  /** Version-mismatch detail when built on a different fiab-core major, else null. */
  coreVersionMismatch: string | null
  version: number
  isFavourite: boolean
  /** First source block's title — derived from the blueprint builder. */
  modelLabel: string | null
  /** Distinct sink-block kinds the configuration produces. */
  outputKinds: Array<string>
  /** Number of sink blocks. */
  outputCount: number
}

export function useConfigPresets() {
  const { data, isLoading } = useListBlueprints(1, 50)
  const deleteMutation = useDeleteBlueprint()
  const { data: catalogue } = useBlockCatalogue()

  const [favourites, setFavourites] = useLocalStorage<FavouritesStore>(
    STORAGE_KEYS.fable.favourites,
    {},
  )

  // Explicitly-saved configs only — drop plugin templates and submission-created blueprints.
  const presetBlueprints = useMemo<Array<BlueprintListItem>>(() => {
    if (!data?.blueprints) return []
    return data.blueprints.filter(
      (bp: BlueprintListItem) =>
        bp.source === 'user_defined' && !isOneoffBlueprint(bp.tags),
    )
  }, [data])

  // Join each preset's builder for the model/output facets (cache-shared with the rows).
  const builders = useQueries({
    queries: presetBlueprints.map((bp) => ({
      queryKey: [...fableKeys.detail(bp.blueprint_id), 'full'] as const,
      queryFn: () => retrieveFable(bp.blueprint_id),
      staleTime: Infinity,
    })),
    combine: (results) => results.map((result) => result.data?.builder),
  })

  const presets = useMemo<Array<PresetEntry>>(() => {
    return presetBlueprints
      .map((bp, index): PresetEntry => {
        const builder = builders[index]
        const canDerive = builder !== undefined && catalogue !== undefined
        return {
          blueprintId: bp.blueprint_id,
          displayName: bp.display_name,
          displayDescription: bp.display_description,
          tags: stripSystemTags(bp.tags),
          coreVersionMismatch: bp.coreVersionMismatch,
          version: bp.version,
          isFavourite: !!favourites[bp.blueprint_id],
          modelLabel: canDerive ? deriveModelLabel(builder, catalogue) : null,
          outputKinds: canDerive ? deriveSinkKinds(builder, catalogue) : [],
          outputCount: canDerive
            ? getBlocksByKind(builder, catalogue, 'sink').length
            : 0,
        }
      })
      .sort((a, b) => {
        // Favourites first
        if (a.isFavourite && !b.isFavourite) return -1
        if (!a.isFavourite && b.isFavourite) return 1
        return 0
      })
  }, [presetBlueprints, builders, catalogue, favourites])

  // Functional setFavourites updates keep these callbacks stable (favourites is
  // not in the closure) so memoised preset rows don't re-render on every render.
  function deletePreset(blueprintId: string, version: number) {
    deleteMutation.mutate(
      { blueprint_id: blueprintId, version },
      {
        onSuccess: () => showToast.success(i18n.t('dashboard:presets.deleted')),
      },
    )
    // Clean up favourite flag
    const { [blueprintId]: _, ...rest } = favourites
    setFavourites(rest)
  }

  function toggleFavourite(blueprintId: string) {
    setFavourites({
      ...favourites,
      [blueprintId]: !favourites[blueprintId],
    })
  }

  const hasPresets = presets.length > 0

  return {
    presets,
    deletePreset,
    toggleFavourite,
    hasPresets,
    isLoading,
  }
}
