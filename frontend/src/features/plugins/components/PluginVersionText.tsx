/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import type { PluginInfo } from '@/api/types/plugins.types'

/** A plugin version in mono type, followed by the version an update brings. */
export function PluginVersionText({
  version,
  plugin,
}: {
  version: string
  plugin: Pick<PluginInfo, 'hasUpdate' | 'latestVersion'>
}) {
  const { t } = useTranslation('plugins')
  return (
    <>
      <span className="font-mono">{t('item.version', { version })}</span>
      {plugin.hasUpdate && plugin.latestVersion && (
        <span className="ml-1 font-mono text-amber-700 dark:text-amber-400">
          {t('card.versionArrow', { version: plugin.latestVersion })}
        </span>
      )}
    </>
  )
}
