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
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

interface PluginToggleProps {
  plugin: PluginInfo
  /** Target enabled value while a toggle is in flight; undefined when idle. */
  pendingEnabled?: boolean
  onToggle: (compositeId: PluginCompositeId, enabled: boolean) => void
}

/**
 * Enable/disable switch. While the async toggle settles it shows the target
 * position optimistically, disables input, and spins — so the click gets
 * immediate feedback despite the catalogue reload behind it.
 */
export function PluginToggle({
  plugin,
  pendingEnabled,
  onToggle,
}: PluginToggleProps) {
  const { t } = useTranslation('plugins')
  const isToggling = pendingEnabled !== undefined

  return (
    <div className="flex items-center gap-2">
      {isToggling && <Spinner className="text-muted-foreground" />}
      <Switch
        checked={isToggling ? pendingEnabled : plugin.isEnabled}
        disabled={isToggling}
        onCheckedChange={(checked) => onToggle(plugin.id, checked)}
        aria-busy={isToggling}
        aria-label={
          plugin.isEnabled ? t('actions.disable') : t('actions.enable')
        }
      />
    </div>
  )
}
