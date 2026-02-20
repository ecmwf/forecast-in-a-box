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
 * PluginsPageHeader Component
 *
 * Header section with title and action buttons for the Plugin Store
 */

import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'

interface PluginsPageHeaderProps {
  onCheckUpdates: () => void
  isCheckingUpdates?: boolean
}

export function PluginsPageHeader({
  onCheckUpdates,
  isCheckingUpdates = false,
}: PluginsPageHeaderProps) {
  const { t } = useTranslation('plugins')

  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="flex flex-col gap-2">
        <H2 className="text-3xl font-semibold tracking-tight">{t('title')}</H2>
        <P className="max-w-2xl text-base text-muted-foreground">
          {t('subtitle')}
        </P>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={onCheckUpdates}
          disabled={isCheckingUpdates}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isCheckingUpdates ? 'animate-spin' : ''}`}
          />
          {t('actions.checkUpdates')}
        </Button>
      </div>
    </div>
  )
}
