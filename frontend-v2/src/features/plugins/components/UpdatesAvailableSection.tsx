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
 * UpdatesAvailableSection Component
 *
 * Displays plugins with available updates in a highlighted section
 */

import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PluginIcon } from './PluginIcon'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import { H3, H4, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'

interface UpdatesAvailableSectionProps {
  plugins: Array<PluginInfo>
  onUpdate: (compositeId: PluginCompositeId) => void
  onViewReleaseNotes?: (plugin: PluginInfo) => void
}

export function UpdatesAvailableSection({
  plugins,
  onUpdate,
  onViewReleaseNotes,
}: UpdatesAvailableSectionProps) {
  const { t } = useTranslation('plugins')

  if (plugins.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Section Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
          {t('updatesSection.title')} ({plugins.length})
        </H3>
      </div>

      {/* Updates Card */}
      <div className="overflow-hidden rounded-xl border border-amber-200 bg-card shadow-sm dark:border-amber-900/30">
        <div className="divide-y divide-amber-100 dark:divide-amber-900/20">
          {plugins.map((plugin) => (
            <div
              key={plugin.displayId}
              className="flex flex-col gap-4 p-4 transition-colors hover:bg-amber-50/30 sm:flex-row sm:items-center sm:p-5 dark:hover:bg-amber-900/10"
            >
              <div className="flex flex-1 items-start gap-4">
                <PluginIcon plugin={plugin} size="lg" />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <H4 className="font-semibold">{plugin.name}</H4>
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      UPDATE v{plugin.latestVersion}
                    </span>
                  </div>
                  <P className="line-clamp-1 text-muted-foreground">
                    {plugin.description}
                  </P>
                  <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{plugin.author}</span>
                    <span>·</span>
                    <span>
                      {t('updatesSection.currentVersion', {
                        version: plugin.version,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 border-amber-100 pt-2 sm:ml-2 sm:border-l sm:pt-0 sm:pl-6 dark:border-amber-900/20">
                {onViewReleaseNotes && (
                  <button
                    className="mr-2 text-sm text-muted-foreground underline decoration-muted-foreground/30 underline-offset-4 hover:text-foreground"
                    onClick={() => onViewReleaseNotes(plugin)}
                  >
                    {t('actions.releaseNotes')}
                  </button>
                )}
                <Button onClick={() => onUpdate(plugin.id)}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('actions.updateNow')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
