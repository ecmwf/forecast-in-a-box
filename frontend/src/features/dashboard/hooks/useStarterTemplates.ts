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
import { useTemplatePresets } from './useTemplatePresets'
import type { TemplateEntry } from './useTemplatePresets'
import type {
  PluginCompositeId,
  PluginListing,
} from '@/api/types/plugins.types'
import {
  ECMWF_BASE_PLUGIN,
  formatPluginIdString,
  parsePluginKey,
} from '@/api/types/plugins.types'
import { usePluginList } from '@/api/hooks/usePlugins'

/** How many templates the dashboard offers alongside the blank canvas. */
export const STARTER_TEMPLATE_LIMIT = 3

/** The listing is keyed by Python repr, so match on parsed fields. */
function findPluginDetail(listing: PluginListing, id: PluginCompositeId) {
  const entry = Object.entries(listing.plugins).find(([key]) => {
    const parsed = parsePluginKey(key)
    return parsed.store === id.store && parsed.local === id.local
  })
  return entry?.[1] ?? null
}

/**
 * Pick the templates offered as starting points, in the order the plugin
 * declares them. Exported for tests.
 */
export function selectStarterTemplates(
  templates: ReadonlyArray<TemplateEntry>,
  includedTemplates: ReadonlyArray<string>,
  limit: number = STARTER_TEMPLATE_LIMIT,
): Array<TemplateEntry> {
  const ecmwfId = formatPluginIdString(ECMWF_BASE_PLUGIN)
  const byName = new Map<string, TemplateEntry>()
  for (const template of templates) {
    // display_name is the join key, so a row without one cannot be ordered.
    if (template.pluginId !== ecmwfId || !template.displayName) continue
    if (!byName.has(template.displayName))
      byName.set(template.displayName, template)
  }

  // No declared order (older backend, or /plugin/list failed): keep the cards
  // and lose only the ordering guarantee.
  const ordered = includedTemplates.length
    ? includedTemplates.map((name) => byName.get(name))
    : [...byName.values()]

  // Filter before slicing, so a template that failed ingest doesn't cost a card.
  return ordered
    .filter((entry): entry is TemplateEntry => entry !== undefined)
    .slice(0, limit)
}

export function useStarterTemplates() {
  const { templates, isLoading, isError, refetch } = useTemplatePresets()
  const { data: listing, isLoading: pluginsLoading } = usePluginList()

  const includedTemplates = useMemo(() => {
    const detail = listing ? findPluginDetail(listing, ECMWF_BASE_PLUGIN) : null
    return detail?.settings_data?.included_templates ?? []
  }, [listing])

  const starters = useMemo(
    () => selectStarterTemplates(templates, includedTemplates),
    [templates, includedTemplates],
  )

  return {
    starters,
    hasStarters: starters.length > 0,
    isLoading: isLoading || pluginsLoading,
    // Only a missing template list is fatal; a missing plugin list just costs ordering.
    isError,
    refetch,
  }
}
