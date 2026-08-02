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
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { readDraft } from '@/features/fable-builder/hooks/useDraftPersistence'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

export interface WorkbenchSummary {
  fable: FableBuilderV1
  fableName: string
  blockCount: number
  /** Banked-slot timestamp; null while only the live store holds the bench. */
  savedAt: number | null
}

/** The workbench occupant: live store first, banked slot on cold boot; null = empty. */
export function useWorkbenchSummary(): WorkbenchSummary | null {
  const fable = useFableBuilderStore((state) => state.fable)
  const fableName = useFableBuilderStore((state) => state.fableName)

  return useMemo(() => {
    const liveBlocks = Object.keys(fable.blocks).length
    if (liveBlocks > 0) {
      return {
        fable,
        fableName,
        blockCount: liveBlocks,
        savedAt: readDraft()?.savedAt ?? null,
      }
    }
    const draft = readDraft()
    if (!draft) return null
    const draftBlocks = Object.keys(draft.fable.blocks).length
    if (draftBlocks === 0) return null
    return {
      fable: draft.fable,
      fableName: draft.fableName,
      blockCount: draftBlocks,
      savedAt: draft.savedAt,
    }
  }, [fable, fableName])
}
