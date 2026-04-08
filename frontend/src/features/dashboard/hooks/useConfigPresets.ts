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
import type { BlueprintListItem } from '@/api/types/fable.types'
import { useDeleteBlueprint, useListBlueprints } from '@/api/hooks/useFable'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/** localStorage only stores favourite flags — everything else comes from the backend */
type FavouritesStore = Record<string, boolean>

export interface PresetEntry {
  blueprintId: string
  displayName: string | null
  displayDescription: string | null
  tags: Array<string>
  version: number
  isFavourite: boolean
}

export function useConfigPresets() {
  const { data, isLoading, isError } = useListBlueprints(1, 50)
  const deleteMutation = useDeleteBlueprint()

  const [favourites, setFavourites] = useLocalStorage<FavouritesStore>(
    STORAGE_KEYS.fable.favourites,
    {},
  )

  const presets = useMemo<Array<PresetEntry>>(() => {
    if (!data?.blueprints) return []

    return data.blueprints
      .map(
        (bp: BlueprintListItem): PresetEntry => ({
          blueprintId: bp.blueprint_id,
          displayName: bp.display_name,
          displayDescription: bp.display_description,
          tags: bp.tags ?? [],
          version: bp.version,
          isFavourite: !!favourites[bp.blueprint_id],
        }),
      )
      .sort((a, b) => {
        // Favourites first
        if (a.isFavourite && !b.isFavourite) return -1
        if (!a.isFavourite && b.isFavourite) return 1
        return 0
      })
  }, [data, favourites])

  function deletePreset(blueprintId: string, version: number) {
    deleteMutation.mutate({ blueprint_id: blueprintId, version })
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
    isError,
    isDeleting: deleteMutation.isPending,
  }
}
