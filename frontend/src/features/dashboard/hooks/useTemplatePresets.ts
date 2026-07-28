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
import { useListBlueprints } from '@/api/hooks/useFable'
import { parsePluginIdString } from '@/api/types/plugins.types'
import { stripSystemTags } from '@/lib/system-tags'

/** A plugin-shipped blueprint template, offered as a starting point */
export interface TemplateEntry {
  blueprintId: string
  version: number
  displayName: string | null
  displayDescription: string | null
  /** Plugin-authored labels, shown as chips */
  tags: Array<string>
  /** Owning plugin as a "store:local" composite string (from created_by) */
  pluginId: string | null
  /** Short plugin label for chips (the local part of the composite id) */
  pluginLabel: string | null
  /** Version-mismatch detail when built on a different fiab-core major, else null. */
  coreVersionMismatch: string | null
}

/** Search params that fork a template into the builder and open its dialog. */
export function templateConfigureSearch(template: TemplateEntry) {
  return {
    fableId: template.blueprintId,
    template: true,
    ...(template.pluginId && { templatePlugin: template.pluginId }),
    ...(template.displayName && { templateName: template.displayName }),
  }
}

export function useTemplatePresets() {
  const { data, isLoading, isError, refetch } = useListBlueprints(1, 50, {
    source: 'plugin_template',
  })

  const templates = useMemo<Array<TemplateEntry>>(() => {
    if (!data?.blueprints) return []
    return data.blueprints.map((bp) => ({
      blueprintId: bp.blueprint_id,
      version: bp.version,
      displayName: bp.display_name,
      displayDescription: bp.display_description,
      tags: stripSystemTags(bp.tags),
      pluginId: bp.created_by,
      pluginLabel: bp.created_by
        ? parsePluginIdString(bp.created_by).local || bp.created_by
        : null,
      coreVersionMismatch: bp.coreVersionMismatch,
    }))
  }, [data])

  return {
    templates,
    hasTemplates: templates.length > 0,
    isLoading,
    isError,
    refetch,
  }
}
