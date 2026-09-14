/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { entryDisplayName } from './entry-ref'
import type { ComparisonEntry } from './entry-ref'
import { formatInZone } from '@/lib/datetime'

/** Stamp the default job name embeds at submission (job-name.ts). */
const NAME_STAMP_PATTERN = 'yyyy-MM-dd HH:mm'

/** Map-caption parts for a slot: the name minus a duplicated submission
 * stamp, and that stamp on its own for output runs. */
export function slotCaption(
  entry: ComparisonEntry,
  timeZone: string,
): { label: string; submittedAt: string | null } {
  const name = entryDisplayName(entry)
  if (entry.kind !== 'output' || !entry.runCreatedAt) {
    return { label: name, submittedAt: null }
  }
  const created = new Date(entry.runCreatedAt)
  const stamp = ` · ${formatInZone(created, timeZone, NAME_STAMP_PATTERN)}`
  return {
    label: name.endsWith(stamp) ? name.slice(0, -stamp.length) : name,
    submittedAt: formatInZone(created, timeZone, 'dd MMM HH:mm'),
  }
}
