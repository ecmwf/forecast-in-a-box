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
import type {
  FableMetadataStore,
  FableSaveMetadata,
} from '@/features/fable-builder/components/SaveConfigPopover'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export interface PresetEntry extends FableSaveMetadata {
  fableId: string
}

export function useConfigPresets() {
  const [metadataStore, setMetadataStore] = useLocalStorage<FableMetadataStore>(
    STORAGE_KEYS.fable.metadata,
    {},
  )

  const presets = useMemo<Array<PresetEntry>>(
    () =>
      Object.entries(metadataStore)
        .map(([fableId, meta]) => ({ fableId, ...meta }))
        .sort((a, b) => {
          // Favourites first
          if (a.isFavourite && !b.isFavourite) return -1
          if (!a.isFavourite && b.isFavourite) return 1
          // Then by date descending
          return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
        }),
    [metadataStore],
  )

  function deletePreset(fableId: string) {
    const { [fableId]: _, ...rest } = metadataStore
    setMetadataStore(rest)
  }

  function toggleFavourite(fableId: string) {
    const existing = metadataStore[fableId] as FableSaveMetadata | undefined
    if (!existing) return
    setMetadataStore({
      ...metadataStore,
      [fableId]: { ...existing, isFavourite: !existing.isFavourite },
    })
  }

  function renamePreset(fableId: string, title: string, comments?: string) {
    const existing = metadataStore[fableId] as FableSaveMetadata | undefined
    if (!existing) return
    setMetadataStore({
      ...metadataStore,
      [fableId]: {
        ...existing,
        title,
        ...(comments !== undefined ? { comments } : {}),
      },
    })
  }

  const hasPresets = presets.length > 0

  return { presets, deletePreset, toggleFavourite, renamePreset, hasPresets }
}
