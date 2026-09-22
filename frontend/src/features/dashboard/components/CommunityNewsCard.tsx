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
import type { NewsLink } from '@/features/dashboard/hooks/useCommunityNews'
import { useCommunityNews } from '@/features/dashboard/hooks/useCommunityNews'
import { H2, H3, Link, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

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
    <div className="flex min-w-0 flex-col gap-3">
      <H3
        className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"
        title={title}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{title}</span>
      </H3>
      <ul className="space-y-3">{children}</ul>
    </div>
  )
}

function NewsItem({ item }: { item: NewsLink }) {
  return (
    // One line each so the card stays short in narrow columns; the title tooltip carries the rest.
    <li className="min-w-0" title={item.title}>
      <Link
        href={item.url}
        underline={false}
        className="block truncate text-sm font-medium"
      >
        {item.title}
      </Link>
      <P className="mt-0.5 truncate text-xs text-muted-foreground">
        {item.date ? `${item.source} · ${item.date}` : item.source}
      </P>
    </li>
  )
}

/** Two-line placeholders in the shape of a news item. */
function NewsItemSkeleton() {
  return (
    <li>
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-1.5 h-3 w-2/5" />
    </li>
  )
}

function NewsList({
  items,
  placeholders,
}: {
  items: ReadonlyArray<NewsLink> | undefined
  placeholders: number
}) {
  if (items === undefined) {
    return Array.from({ length: placeholders }, (_, i) => (
      <NewsItemSkeleton key={i} />
    ))
  }
  return items.map((item) => <NewsItem key={item.url} item={item} />)
}

export function CommunityNewsCard() {
  const { t } = useTranslation('dashboard')
  const { data, isError } = useCommunityNews()

  return (
    <Card className="flex flex-col p-6">
      <H2 className="mb-6 text-xl font-semibold">{t('community.title')}</H2>
      {isError ? (
        <P className="text-sm text-muted-foreground">
          {t('community.unavailable')}
        </P>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-2">
          <Section Icon={Newspaper} title={t('community.press')}>
            <NewsList items={data?.press} placeholders={5} />
          </Section>

          <div className="flex flex-col gap-8">
            <Section Icon={Presentation} title={t('community.materials')}>
              <NewsList items={data?.materials} placeholders={3} />
            </Section>

            <Section Icon={Package} title={t('community.softwareAndCommunity')}>
              <NewsList items={data?.community} placeholders={3} />
            </Section>
          </div>
        </div>
      )}
    </Card>
  )
}
