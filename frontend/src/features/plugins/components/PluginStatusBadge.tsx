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
 * PluginStatusBadge Component
 *
 * Displays a status badge for a plugin.
 *
 * Status values from backend:
 * - available: Plugin is in store but not installed
 * - disabled: Plugin is installed but disabled
 * - errored: Plugin encountered an error during load
 * - loaded: Plugin is installed and running
 */

import { useTranslation } from 'react-i18next'
import type { PluginStatus } from '@/api/types/plugins.types'
import type { StatusBadgeVariant } from '@/components/common/StatusBadge'
import {
  STATUS_BADGE_VARIANTS,
  StatusBadge,
} from '@/components/common/StatusBadge'

interface PluginStatusBadgeProps {
  status: PluginStatus
  /** Whether an update is available (shown as visual indicator) */
  hasUpdate?: boolean
  className?: string
}

export function PluginStatusBadge({
  status,
  hasUpdate,
  className,
}: PluginStatusBadgeProps) {
  const { t } = useTranslation('plugins')

  const statusConfig: Record<PluginStatus, StatusBadgeVariant> = {
    loaded: { label: t('status.loaded'), ...STATUS_BADGE_VARIANTS.active },
    disabled: {
      label: t('status.disabled'),
      ...STATUS_BADGE_VARIANTS.disabled,
    },
    available: {
      label: t('status.available'),
      ...STATUS_BADGE_VARIANTS.available,
    },
    errored: { label: t('status.errored'), ...STATUS_BADGE_VARIANTS.error },
  }

  const variant: StatusBadgeVariant =
    hasUpdate && status === 'loaded'
      ? { label: t('status.updateAvailable'), ...STATUS_BADGE_VARIANTS.warning }
      : statusConfig[status]

  return <StatusBadge variant={variant} className={className} />
}
