/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Newspaper, Package, Presentation } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { NewsLink } from '@/features/dashboard/data/communityNews'
import {
  COMMUNITY_ITEMS,
  MATERIAL_ITEMS,
  PRESS_ITEMS,
} from '@/features/dashboard/data/communityNews'
import { H2, H3, Link, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'

function Section({
  Icon,
  title,
  children,
}: {
  Icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <H3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
      </H3>
      <ul className="space-y-3">{children}</ul>
    </div>
  )
}

function NewsItem({ item }: { item: NewsLink }) {
  return (
    <li>
      <Link href={item.url} underline={false} className="text-sm font-medium">
        {item.title}
      </Link>
      <P className="mt-0.5 text-xs text-muted-foreground">
        {item.date ? `${item.source} · ${item.date}` : item.source}
      </P>
    </li>
  )
}

export function CommunityNewsCard() {
  const { t } = useTranslation('dashboard')

  return (
    <Card className="flex flex-col p-6">
      <H2 className="mb-6 text-xl font-semibold">{t('community.title')}</H2>
      <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-2">
        <Section Icon={Newspaper} title={t('community.press')}>
          {PRESS_ITEMS.map((item) => (
            <NewsItem key={item.url} item={item} />
          ))}
        </Section>

        <div className="flex flex-col gap-8">
          <Section Icon={Presentation} title={t('community.materials')}>
            {MATERIAL_ITEMS.map((item) => (
              <NewsItem key={item.url} item={item} />
            ))}
          </Section>

          <Section Icon={Package} title={t('community.softwareAndCommunity')}>
            {COMMUNITY_ITEMS.map((item) => (
              <NewsItem key={item.url} item={item} />
            ))}
          </Section>
        </div>
      </div>
    </Card>
  )
}
