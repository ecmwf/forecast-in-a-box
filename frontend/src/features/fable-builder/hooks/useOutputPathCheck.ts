/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useRef } from 'react'
import type { BlockInstance } from '@/api/types/fable.types'
import type { SharedOutputPath } from '@/features/fable-builder/utils/run-folder-nudge'
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'
import {
  isSharedAcrossRuns,
  namesRunId,
  runScopedPath,
  withRunFolder,
} from '@/features/fable-builder/utils/run-folder-nudge'

/** The block's output path shared across runs, by config key. */
export function useOutputPathCheck(
  blockId: string | null,
  block: BlockInstance | null,
  resolvedConfig: Record<string, string | null> | null,
): Record<string, SharedOutputPath> | null {
  // The preview resolves runId to this example value.
  const runId = useGlyphContext().find(
    (g) => g.type === 'intrinsic' && g.name === 'runId',
  )?.valueExample
  // Last verdict per block, kept through the validation gap.
  const lastShared = useRef<Record<string, boolean>>({})

  const path = block ? runScopedPath(block.factory_id) : null
  const configKey = path?.configKey ?? null
  const value = (configKey && block?.configuration_values[configKey]) || ''
  if (blockId && path && value) {
    const resolved = containsGlyphs(value)
      ? (resolvedConfig?.[path.configKey] ?? null)
      : value
    // A literal runId glyph wins: the preview's run ID changes on restart.
    const verdict = namesRunId(value, path.scope)
      ? false
      : resolved !== null && runId
        ? isSharedAcrossRuns(resolved, runId, path.scope)
        : null
    if (verdict !== null) lastShared.current[blockId] = verdict
  }
  const shared = !!blockId && !!value && lastShared.current[blockId] === true
  const fix = shared ? withRunFolder(value) : null
  const scope = path?.scope ?? null

  return useMemo(
    () =>
      shared && configKey && scope ? { [configKey]: { scope, fix } } : null,
    [shared, configKey, scope, fix],
  )
}
