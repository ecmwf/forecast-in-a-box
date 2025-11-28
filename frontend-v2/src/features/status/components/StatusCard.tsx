/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * StatusCard component
 * Displays the system status information in a card
 */

import { useTranslation } from 'react-i18next'
import { useStatus } from '../hooks/useStatus'
import { StatusBadge } from './StatusBadge'
import type { ServiceStatus } from '@/types/status.types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function StatusCard() {
  const { t } = useTranslation()
  const { data, isLoading, isError, error, dataUpdatedAt } = useStatus()

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{t('status.card.title')}</CardTitle>
          <CardDescription>{t('status.card.loading')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card className="w-full max-w-2xl border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">
            {t('status.card.titleError')}
          </CardTitle>
          <CardDescription>{t('status.card.errorMessage')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : t('status.card.unknownError')}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return null
  }

  // Transform data into service status array
  const services: Array<ServiceStatus> = [
    { name: 'api', status: data.api, label: t('status.services.api') },
    {
      name: 'cascade',
      status: data.cascade,
      label: t('status.services.cascade'),
    },
    { name: 'ecmwf', status: data.ecmwf, label: t('status.services.ecmwf') },
    {
      name: 'scheduler',
      status: data.scheduler,
      label: t('status.services.scheduler'),
    },
  ]

  // Format last updated time
  const lastUpdated = new Date(dataUpdatedAt).toLocaleTimeString()

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{t('status.card.title')}</CardTitle>
        <CardDescription>
          {t('status.card.description')}
          {dataUpdatedAt && (
            <span className="ml-2 text-xs text-muted-foreground">
              ({t('status.card.lastUpdated')}: {lastUpdated})
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Services Status */}
          <div className="grid gap-3">
            {services.map((service) => (
              <div
                key={service.name}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <span className="font-medium">{service.label}</span>
                <StatusBadge status={service.status} />
              </div>
            ))}
          </div>

          {/* Version Information */}
          <div className="mt-6 rounded-lg bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {t('status.version')}
              </span>
              <span className="text-sm font-mono">{data.version}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
