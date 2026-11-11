/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { CapabilityBadges } from './CapabilityBadges'
import { PluginActions, usePluginBusyLabel } from './PluginActions'
import { PluginDiagnostics } from './PluginDiagnostics'
import { PluginIcon } from './PluginIcon'
import { PluginStatusText } from './PluginStatusText'
import { PluginVersionText } from './PluginVersionText'
import type { PluginItemHandlers } from './PluginActions'
import type { PluginOperation } from '@/api/hooks/usePlugins'
import type { PluginInfo } from '@/api/types/plugins.types'
import { encodePluginId, pluginDisplayVersion } from '@/api/types/plugins.types'
import {
  CatalogueFact,
  CatalogueFacts,
} from '@/components/common/catalogue/CatalogueFacts'
import { Card } from '@/components/ui/card'
import { P } from '@/components/base/typography'

interface PluginCardProps extends PluginItemHandlers {
  plugin: PluginInfo
  operation: PluginOperation | undefined
}

export function PluginCard({
  plugin,
  operation,
  ...handlers
}: PluginCardProps) {
  const { t } = useTranslation('plugins')
  const busyLabel = usePluginBusyLabel(operation)

  // plugin.updatedAt is Z-suffixed UTC; don't route through serverTimeToLocal.
  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNow(new Date(plugin.updatedAt), { addSuffix: true })
    : null
  const version = pluginDisplayVersion(plugin)

  return (
    <Card className="group w-full gap-0 py-0 transition-colors hover:border-primary/30">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex min-w-0 gap-3">
          <PluginIcon plugin={plugin} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              <Link
                to="/admin/plugins/$pluginId"
                params={{ pluginId: encodePluginId(plugin.id) }}
                className="hover:underline"
              >
                {plugin.name}
              </Link>
            </h3>
            <P className="mt-0.5 truncate text-muted-foreground">
              {plugin.author}
            </P>
          </div>
        </div>

        <P className="line-clamp-2 min-h-10 text-muted-foreground">
          {plugin.description}
        </P>

        {plugin.errorDetail && (
          <PluginDiagnostics errors={plugin.errorDetail} className="py-2" />
        )}

        {/* The table's columns as labelled values. */}
        <CatalogueFacts className="mt-auto">
          {version && (
            <CatalogueFact label={t('card.version')}>
              <PluginVersionText version={version} plugin={plugin} />
            </CatalogueFact>
          )}
          {updatedTimeAgo && (
            <CatalogueFact label={t('table.headers.updated')}>
              {updatedTimeAgo}
            </CatalogueFact>
          )}
          <CatalogueFact label={t('table.headers.status')}>
            <PluginStatusText plugin={plugin} busyLabel={busyLabel} />
          </CatalogueFact>
        </CatalogueFacts>

        {plugin.capabilities.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <CapabilityBadges capabilities={plugin.capabilities} />
          </div>
        )}
      </div>

      <div className="flex items-center border-t border-border/60 px-5 py-3">
        <PluginActions
          plugin={plugin}
          operation={operation}
          layout="card"
          {...handlers}
        />
      </div>
    </Card>
  )
}
