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
 * Plugin Detail Route
 *
 * Shows full details for a single plugin, identified by $pluginId URL param.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import { usePlugins } from '@/api/hooks/usePlugins'
import { decodePluginId, toPluginDisplayId } from '@/api/types/plugins.types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PluginDetailPage } from '@/features/plugins'

export const Route = createFileRoute('/_authenticated/admin/plugins/$pluginId')(
  {
    component: PluginDetailRoute,
  },
)

function PluginDetailRoute() {
  const { pluginId } = Route.useParams()
  const compositeId = decodePluginId(pluginId)
  const displayId = toPluginDisplayId(compositeId)

  const { data: catalogue } = useBlockCatalogue()
  const { plugins, isLoading } = usePlugins(catalogue)

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const plugin = plugins.find((p) => p.displayId === displayId)

  if (!plugin) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-muted-foreground">
        Plugin not found: {displayId}
      </div>
    )
  }

  return <PluginDetailPage plugin={plugin} catalogue={catalogue} />
}
