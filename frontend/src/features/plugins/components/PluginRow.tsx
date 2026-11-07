/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { formatDistanceToNowStrict } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { PluginActions, usePluginBusyLabel } from './PluginActions'
import { PluginIcon } from './PluginIcon'
import { PluginStatusText } from './PluginStatusText'
import { PluginVersionText } from './PluginVersionText'
import type { PluginItemHandlers } from './PluginActions'
import type { PluginOperation } from '@/api/hooks/usePlugins'
import type { PluginInfo } from '@/api/types/plugins.types'
import { pluginDisplayVersion } from '@/api/types/plugins.types'
import { H4, P } from '@/components/base/typography'
import { CatalogueRow } from '@/components/common/catalogue/CatalogueView'

interface PluginRowProps extends PluginItemHandlers {
  plugin: PluginInfo
  operation: PluginOperation | undefined
}

export function PluginRow({ plugin, operation, ...handlers }: PluginRowProps) {
  const { t } = useTranslation('plugins')
  const busyLabel = usePluginBusyLabel(operation)

  // plugin.updatedAt is Z-suffixed UTC; don't route through serverTimeToLocal.
  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNowStrict(new Date(plugin.updatedAt), {
        addSuffix: true,
      })
    : null
  const version = pluginDisplayVersion(plugin)

  return (
    <CatalogueRow>
      <div className="flex min-w-0 items-start gap-3">
        <PluginIcon plugin={plugin} size="sm" />
        <div className="min-w-0">
          <H4 className="truncate text-sm font-semibold">{plugin.name}</H4>
          <P className="mt-0.5 truncate text-muted-foreground">
            {t('row.byline', {
              author: plugin.author,
              description: plugin.description,
            })}
          </P>
        </div>
      </div>

      <div className="hidden min-w-0 lg:block">
        {updatedTimeAgo && (
          <div className="truncate text-sm">{updatedTimeAgo}</div>
        )}
        {version && (
          <div className="text-sm text-muted-foreground">
            <PluginVersionText version={version} plugin={plugin} />
          </div>
        )}
      </div>

      <div>
        <PluginStatusText plugin={plugin} busyLabel={busyLabel} />
      </div>

      <PluginActions
        plugin={plugin}
        operation={operation}
        layout="row"
        {...handlers}
      />
    </CatalogueRow>
  )
}
