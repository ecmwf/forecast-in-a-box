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
 * GettingStartedSection Component
 *
 * A blank canvas plus the starting points the ECMWF plugin ships as templates.
 */

import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { ContinueWorkbenchCard } from './ContinueWorkbenchCard'
import { GettingStartedCard } from './GettingStartedCard'
import {
  TemplateStarterCard,
  TemplateStarterCardSkeleton,
} from './TemplateStarterCard'
import type { ReactNode } from 'react'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import {
  STARTER_TEMPLATE_LIMIT,
  useStarterTemplates,
} from '@/features/dashboard/hooks/useStarterTemplates'
import { useWorkbenchSummary } from '@/features/fable-builder/hooks/useWorkbenchSummary'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface GettingStartedSectionProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

/** Informational filler for the tracks the template cards would have taken. */
function StarterPanel({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-start justify-center rounded-lg border border-dashed p-5 md:col-span-1 lg:col-span-3">
      <p className="mb-1 text-base font-bold">{title}</p>
      <P className="mb-4 text-muted-foreground">{description}</P>
      {action}
    </div>
  )
}

export function GettingStartedSection({
  variant,
  shadow,
}: GettingStartedSectionProps) {
  const { t } = useTranslation(['dashboard', 'common'])
  const navigate = useNavigate()
  const { starters, hasStarters, isLoading, isError, refetch } =
    useStarterTemplates()
  const workbench = useWorkbenchSummary()

  const content = (
    <>
      <div className="mb-6">
        <H2 className="text-xl font-semibold">{t('gettingStarted.title')}</H2>
        <P className="mt-1 text-muted-foreground">
          {t('gettingStarted.subtitle')}
        </P>
      </div>

      {workbench && <ContinueWorkbenchCard summary={workbench} />}

      {/* Fixed four tracks: the card count varies, but matching the presets row
          below matters more than absorbing the gap. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Always available, and the only card that needs no backend. */}
        <GettingStartedCard
          icon={<Layers className="h-5 w-5" />}
          title={t('gettingStarted.startFromScratch.title')}
          ariaLabel={t('gettingStarted.startFromScratch.title')}
          description={t('gettingStarted.startFromScratch.description')}
          tags={[
            t('gettingStarted.startFromScratch.tags.canvas'),
            t('gettingStarted.startFromScratch.tags.control'),
          ]}
          isRecommended
          onClick={() =>
            navigate({ to: '/configure', search: { fresh: true } })
          }
        />

        {isLoading && (
          <>
            {/* Absolutely positioned, so it announces without taking a grid track. */}
            <span role="status" className="sr-only">
              {t('gettingStarted.templates.loading')}
            </span>
            {Array.from({ length: STARTER_TEMPLATE_LIMIT }, (_, index) => (
              <TemplateStarterCardSkeleton key={index} />
            ))}
          </>
        )}

        {!isLoading &&
          hasStarters &&
          starters.map((template, index) => (
            <TemplateStarterCard
              key={template.blueprintId}
              template={template}
              position={index}
            />
          ))}

        {!isLoading && isError && (
          <StarterPanel
            title={t('gettingStarted.templates.errorTitle')}
            description={t('gettingStarted.templates.errorDescription')}
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                {t('common:retry')}
              </Button>
            }
          />
        )}

        {!isLoading && !isError && !hasStarters && (
          <StarterPanel
            title={t('gettingStarted.templates.emptyTitle')}
            description={t('gettingStarted.templates.emptyDescription')}
            action={
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/admin/plugins" />}
                nativeButton={false}
              >
                {t('gettingStarted.templates.managePlugins')}
              </Button>
            }
          />
        )}
      </div>
    </>
  )

  // Modern variant: no card wrapper, content floats on page background
  if (variant === 'modern') {
    return <div className="space-y-6">{content}</div>
  }

  return (
    <Card className="p-8" variant={variant} shadow={shadow}>
      {content}
    </Card>
  )
}
