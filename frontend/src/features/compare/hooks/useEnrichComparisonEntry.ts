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
 * Lazily fill an output entry's display metadata (run name, sink title,
 * created-at) from the run → blueprint → block catalogue chain. Entries
 * added from contexts that don't know these (active-lens rows, hydrated
 * URLs) start as stubs; this hook upgrades them once. Values are written
 * only when they actually change, and stay snapshotted afterwards so the
 * basket remains readable if the run is later deleted.
 */

import { useEffect } from 'react'
import { entryRef } from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
import type { ComparisonEntry, OutputComparisonEntry } from '../entry-ref'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'
import { useBlockCatalogue, useFableRetrieve } from '@/api/hooks/useFable'
import { useJobStatus } from '@/api/hooks/useJobs'

function missingMeta(o: OutputComparisonEntry): boolean {
  return (
    o.runName === '' || o.runCreatedAt === null || o.blockTitle === o.blockId
  )
}

export function useEnrichComparisonEntry(entry: ComparisonEntry): void {
  const output = entry.kind === 'output' ? entry : null
  // Only stubs are enriched; complete snapshots never refetch.
  const target = output && missingMeta(output) ? output : null

  const { data: jobData } = useJobStatus(target?.jobId)
  const { data: fableData } = useFableRetrieve(
    target ? jobData?.blueprint_id : undefined,
  )
  const { data: catalogue } = useBlockCatalogue()
  const updateOutputMeta = useComparisonStore((s) => s.updateOutputMeta)

  useEffect(() => {
    if (!target) return
    const meta: Parameters<typeof updateOutputMeta>[1] = {}
    const runName = fableData?.display_name?.trim()
    if (runName && target.runName === '') meta.runName = runName
    if (jobData?.created_at && target.runCreatedAt === null) {
      meta.runCreatedAt = jobData.created_at
    }
    if (
      target.blockTitle === target.blockId &&
      fableData?.builder &&
      catalogue
    ) {
      // Cast to surface runtime undefined (no noUncheckedIndexedAccess).
      const blockInstance = fableData.builder.blocks[target.blockId] as
        | FableBuilderV1['blocks'][string]
        | undefined
      const title = blockInstance
        ? getFactory(catalogue, blockInstance.factory_id)?.title
        : undefined
      if (title) meta.blockTitle = title
    }
    if (Object.keys(meta).length > 0) {
      updateOutputMeta(entryRef(target), meta)
    }
  }, [target, jobData, fableData, catalogue, updateOutputMeta])
}
