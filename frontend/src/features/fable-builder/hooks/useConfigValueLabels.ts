/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useParamLabels } from '@/api/hooks/useFable'
import { useArtifactLabels } from '@/api/hooks/useArtifacts'
import {
  listItems,
  paramListLabel,
} from '@/components/base/fields/param-display'
import { displayKindOf } from '@/components/base/fields/value-type-parser'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'

/** `compact` for chips ("2t, msl"), `full` where there is room. */
export interface ValueLabel {
  compact: string
  full: string
  /** The raw config value the label stands for. */
  value: string
  /** Resolved params, for per-param hover details; absent for artifacts. */
  params?: Array<{ id: string; display: string }>
}

/** Labels param/artifact config values; anything unresolved is absent. */
export function useConfigValueLabels(
  values: Record<string, string>,
  valueTypes: Record<string, string | undefined>,
): Record<string, ValueLabel> {
  const kinds: Record<string, 'param' | 'artifact'> = {}
  for (const [key, value] of Object.entries(values)) {
    if (containsGlyphs(value)) continue
    const kind = displayKindOf(valueTypes[key])
    if (kind) kinds[key] = kind
  }
  const paramLabels = useParamLabels(
    Object.entries(kinds).flatMap(([key, kind]) =>
      kind === 'param' ? listItems(values[key]) : [],
    ),
  )
  const artifactLabels = useArtifactLabels(
    Object.values(kinds).includes('artifact'),
  )

  const labels: Record<string, ValueLabel> = {}
  for (const [key, kind] of Object.entries(kinds)) {
    const value = values[key]
    if (kind === 'artifact') {
      const label = artifactLabels.get(value)
      if (label !== undefined) {
        labels[key] = { compact: label, full: label, value }
      }
    } else if (listItems(value).some((id) => paramLabels.has(id))) {
      labels[key] = {
        compact: paramListLabel(value, paramLabels, 'compact'),
        full: paramListLabel(value, paramLabels, 'full'),
        value,
        params: listItems(value).flatMap((id) => {
          const display = paramLabels.get(id)
          return display === undefined ? [] : [{ id, display }]
        }),
      }
    }
  }
  return labels
}
