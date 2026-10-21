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
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'
import {
  isSharedAcrossRuns,
  namesRunId,
  runScopedPath,
  withRunFolder,
} from '@/features/fable-builder/utils/run-folder-nudge'

/** The block's output path shared across runs: config key -> one-click fix (null: none). */
export function useOutputPathCheck(
  blockId: string | null,
  block: BlockInstance | null,
  resolvedConfig: Record<string, string | null> | null,
): Record<string, string | null> | null {
  // The preview resolves runId to this example value.
  const runId = useGlyphContext().find(
    (g) => g.type === 'intrinsic' && g.name === 'runId',
  )?.valueExample
  // Last verdict per block, kept through the validation gap.
  const lastShared = useRef<Record<string, boolean>>({})

  const path = block ? runScopedPath(block.factory_id) : null
  const configKey = path?.configKey ?? null
  const value = (configKey && block?.configuration_values[configKey]) || ''
  if (blockId && path && runId && value) {
    const resolved = containsGlyphs(value)
      ? (resolvedConfig?.[path.configKey] ?? null)
      : value
    // Without a preview, only a literal runId glyph settles it.
    const verdict =
      resolved !== null
        ? isSharedAcrossRuns(resolved, runId, path.scope)
        : namesRunId(value, path.scope)
          ? false
          : null
    if (verdict !== null) lastShared.current[blockId] = verdict
  }
  const shared = !!blockId && !!value && lastShared.current[blockId] === true
  const fix = shared ? withRunFolder(value) : null

  return useMemo(
    () => (shared && configKey ? { [configKey]: fix } : null),
    [shared, configKey, fix],
  )
}
