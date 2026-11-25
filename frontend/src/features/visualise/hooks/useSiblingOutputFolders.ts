/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useQueries } from '@tanstack/react-query'
import { entryRef } from '../entry-ref'
import type { ComparisonEntry } from '../entry-ref'
import { distinctFolderNames } from '@/features/executions/outputs/compare-outputs'
import { storedDirQueryOptions } from '@/features/executions/outputs/stored-dir'

/** Folder name per entry ref when both sides are outputs of one run in different folders; else empty. */
export function useSiblingOutputFolders(
  a: ComparisonEntry | null,
  b: ComparisonEntry | null,
): Record<string, string> {
  const pair =
    a?.kind === 'output' &&
    b?.kind === 'output' &&
    a.jobId === b.jobId &&
    a.taskId !== b.taskId
      ? [a, b]
      : []
  // Same queries the lens start uses, so these come from the cache.
  const [dirA, dirB] = useQueries({
    queries: pair.map((entry) =>
      storedDirQueryOptions(entry.jobId, entry.taskId),
    ),
  }).map((query) => query.data)
  if (pair.length < 2 || !dirA || !dirB) return {}
  const [nameA, nameB] = distinctFolderNames([dirA, dirB])
  if (!nameA || !nameB) return {}
  return { [entryRef(pair[0])]: nameA, [entryRef(pair[1])]: nameB }
}
