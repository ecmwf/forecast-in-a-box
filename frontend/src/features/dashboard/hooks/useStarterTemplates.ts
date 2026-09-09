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
import type { PluginListing } from '@/api/types/plugins.types'
import {
  ECMWF_BASE_PLUGIN,
  formatPluginIdString,
  parsePluginKey,
} from '@/api/types/plugins.types'
import { usePluginList } from '@/api/hooks/usePlugins'

/** How many templates the dashboard offers alongside the blank canvas. */
export const STARTER_TEMPLATE_LIMIT = 3

/** Declared template order per plugin, keyed by "store:local". */
export type TemplateOrderByPlugin = Readonly<
  Record<string, ReadonlyArray<string>>
>

/** The listing is keyed by Python repr; re-key it by "store:local". */
function templateOrderFrom(listing: PluginListing): TemplateOrderByPlugin {
  const order: Record<string, ReadonlyArray<string>> = {}
  for (const [key, detail] of Object.entries(listing.plugins)) {
    const parsed = parsePluginKey(key)
    const included = detail.settings_data?.included_templates
    if (included?.length) order[formatPluginIdString(parsed)] = included
  }
  return order
}

/**
 * Pick the templates offered as starting points: the official plugin's when
 * it is installed, otherwise any plugin's, each in its declared order.
 * Exported for tests.
 */
export function selectStarterTemplates(
  templates: ReadonlyArray<TemplateEntry>,
  orderByPlugin: TemplateOrderByPlugin,
  limit: number = STARTER_TEMPLATE_LIMIT,
): Array<TemplateEntry> {
  // display_name is the join key, so a row without one cannot be ordered.
  const byPlugin = new Map<string, Map<string, TemplateEntry>>()
  for (const template of templates) {
    if (!template.pluginId || !template.displayName) continue
    const byName = byPlugin.get(template.pluginId) ?? new Map()
    if (!byName.has(template.displayName))
      byName.set(template.displayName, template)
    byPlugin.set(template.pluginId, byName)
  }

  const ecmwfId = formatPluginIdString(ECMWF_BASE_PLUGIN)
  const pluginIds = byPlugin.has(ecmwfId)
    ? [ecmwfId]
    : [...byPlugin.keys()].sort()

  const ordered: Array<TemplateEntry> = []
  for (const pluginId of pluginIds) {
    const byName = byPlugin.get(pluginId)!
    const declared = orderByPlugin[pluginId] ?? []
    // No declared order (older backend, or /plugin/list failed): keep the
    // cards and lose only the ordering guarantee.
    ordered.push(
      ...(declared.length
        ? declared.flatMap((name) => byName.get(name) ?? [])
        : [...byName.values()]),
    )
  }
  // Filter happened before slicing, so a failed ingest doesn't cost a card.
  return ordered.slice(0, limit)
}

export function useStarterTemplates() {
  const { templates, isLoading, isError, refetch } = useTemplatePresets()
  const { data: listing, isLoading: pluginsLoading } = usePluginList()

  const orderByPlugin = useMemo(
    () => (listing ? templateOrderFrom(listing) : {}),
    [listing],
  )

  const starters = useMemo(
    () => selectStarterTemplates(templates, orderByPlugin),
    [templates, orderByPlugin],
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
