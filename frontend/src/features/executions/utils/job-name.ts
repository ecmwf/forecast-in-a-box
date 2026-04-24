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
 * Derive a human-readable default name for a one-off job submission.
 *
 * The rules, in priority order:
 *   1. If the fable was saved as a blueprint with a display name, reuse it
 *      and append a run timestamp so repeated runs stay distinguishable.
 *   2. Otherwise, walk the fable and compose `<Source title> · <Sink title> ·
 *      <date>` — the source/sink factory titles are the most information-dense
 *      parts of a fable; transforms/products are usually intermediate.
 *   3. Fall back to a `Run · <timestamp>` label when we have nothing to work
 *      with (empty fable, missing catalogue).
 *
 * The resulting string is trimmed to 72 chars so it reads well in list views.
 */

import type {
  BlockFactoryCatalogue,
  BlockInstance,
  FableBuilderV1,
  FableRetrieveResponse,
} from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'

// Matches either a full datetime-local (`YYYY-MM-DDTHH:MM`) or a bare date
// (`YYYY-MM-DD`) at the start of the string. Good enough to pick out
// `base_time` / `date` config values without parsing them semantically.
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?/

const MAX_LENGTH = 72

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatTimestampLabel(now: Date): string {
  const yyyy = now.getFullYear()
  return `${yyyy}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

function extractDateOnly(raw: string): string {
  const match = raw.match(DATE_LIKE)
  return match ? match[0].slice(0, 10) : raw
}

function firstDatetimeConfigValue(blocks: Array<BlockInstance>): string | null {
  for (const block of blocks) {
    for (const value of Object.values(block.configuration_values)) {
      if (typeof value === 'string' && DATE_LIKE.test(value)) {
        return value
      }
    }
  }
  return null
}

export interface BuildDefaultJobNameInput {
  fable: FableBuilderV1
  catalogue: BlockFactoryCatalogue | undefined
  /** Saved-blueprint metadata, when the fable was loaded from `/blueprint/get`. */
  fableData?: Pick<FableRetrieveResponse, 'display_name'> | undefined
  /** Injection point for deterministic tests. */
  now?: Date
}

export function buildDefaultJobName({
  fable,
  catalogue,
  fableData,
  now = new Date(),
}: BuildDefaultJobNameInput): string {
  const timestamp = formatTimestampLabel(now)

  if (fableData?.display_name) {
    return truncate(`${fableData.display_name} · ${timestamp}`)
  }

  const blocks = Object.values(fable.blocks)
  if (!catalogue || blocks.length === 0) {
    return `Run · ${timestamp}`
  }

  let sourceTitle: string | undefined
  let sinkTitle: string | undefined
  for (const block of blocks) {
    const factory = getFactory(catalogue, block.factory_id)
    if (!factory) continue
    if (!sourceTitle && factory.kind === 'source') sourceTitle = factory.title
    if (!sinkTitle && factory.kind === 'sink') sinkTitle = factory.title
    if (sourceTitle && sinkTitle) break
  }

  const configDatetime = firstDatetimeConfigValue(blocks)
  const dateLabel = configDatetime ? extractDateOnly(configDatetime) : timestamp

  const parts = [sourceTitle, sinkTitle, dateLabel].filter(
    (part): part is string => Boolean(part),
  )
  if (parts.length === 0) {
    return `Run · ${timestamp}`
  }
  return truncate(parts.join(' · '))
}

function truncate(raw: string): string {
  if (raw.length <= MAX_LENGTH) return raw
  return `${raw.slice(0, MAX_LENGTH - 1)}…`
}
