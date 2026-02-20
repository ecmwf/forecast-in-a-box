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
 * CommunityNewsCard Component
 *
 * Shows latest models and forum topics
 */

import { ChevronRight, MessageSquare, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { mockForumTopics, mockModels } from '@/features/dashboard/data/mockData'
import { H2, H3, H4, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface CommunityNewsCardProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function CommunityNewsCard({ variant, shadow }: CommunityNewsCardProps) {
  const { t } = useTranslation('dashboard')

  return (
    <Card className="flex flex-col p-6" variant={variant} shadow={shadow}>
      <H2 className="mb-6 text-xl font-semibold">{t('community.title')}</H2>

      <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-2">
        {/* Latest Available Models */}
        <div className="flex flex-col gap-5">
          <H3 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Zap className="h-4 w-4" />
            {t('community.latestModels')}
          </H3>
          <div className="flex-1 space-y-4">
            {mockModels.map((model) => (
              <div key={`${model.name}-${model.version}`}>
                <div className="flex items-start justify-between">
                  <H4 className="text-sm font-medium">
                    {model.name} {model.version}
                  </H4>
                  {model.isNew && (
                    <Badge
                      variant="secondary"
                      className="bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    >
                      {t('community.new')}
                    </Badge>
                  )}
                </div>
                <P className="mt-0.5 text-muted-foreground">
                  {t('community.released', { time: model.releasedAt })}
                </P>
              </div>
            ))}
          </div>
          <a
            href="https://github.com/ecmwf/anemoi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            {t('community.viewRegistry')}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </a>
        </div>

        {/* Latest Forum Topics */}
        <div className="flex flex-col gap-5 border-l-0 border-border pl-0 sm:border-l sm:pl-8">
          <H3 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <MessageSquare className="h-4 w-4" />
            {t('community.latestTopics')}
          </H3>
          <div className="flex-1 space-y-4">
            {mockForumTopics.map((topic, index) => (
              <div key={index}>
                <H4 className="text-sm leading-snug font-medium">
                  {topic.title}
                </H4>
                <P className="mt-0.5 text-muted-foreground">
                  {t('community.postedBy', {
                    author: topic.author,
                    time: topic.postedAt,
                  })}
                </P>
              </div>
            ))}
          </div>
          <a
            href="https://forum.ecmwf.int"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            {t('community.visitForum')}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </a>
        </div>
      </div>
    </Card>
  )
}
