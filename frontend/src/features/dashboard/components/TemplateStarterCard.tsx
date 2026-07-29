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
 * TemplateStarterCard Component
 *
 * A plugin-shipped blueprint template offered as a starting point on the dashboard.
 */

import { LayoutTemplate } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { templateConfigureSearch } from '../hooks/useTemplatePresets'
import { GettingStartedCard } from './GettingStartedCard'
import type { TemplateEntry } from '../hooks/useTemplatePresets'
import { useFable } from '@/api/hooks/useFable'
import { Skeleton } from '@/components/ui/skeleton'

/** Chips the card has room for. */
const MAX_TAGS = 3

/**
 * Accent per grid position. Colour only — the icon stays neutral because
 * nothing in a template reliably maps to a content-specific glyph.
 */
const STARTER_ACCENTS = [
  {
    iconColor:
      'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    borderColor: 'border-border hover:border-blue-400',
  },
  {
    iconColor:
      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-border hover:border-emerald-400',
  },
  {
    iconColor:
      'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    borderColor: 'border-border hover:border-purple-400',
  },
] as const

interface TemplateStarterCardProps {
  template: TemplateEntry
  /** Index into STARTER_ACCENTS; wraps if the limit ever grows. */
  position: number
}

export function TemplateStarterCard({
  template,
  position,
}: TemplateStarterCardProps) {
  const navigate = useNavigate()
  // The list endpoint omits the builder, and only the preview needs it — so the
  // card renders immediately and the flow appears once this resolves.
  const { data: builder } = useFable(template.blueprintId)
  const accent = STARTER_ACCENTS[position % STARTER_ACCENTS.length]

  const title = template.displayName ?? ''

  return (
    <GettingStartedCard
      icon={<LayoutTemplate className="h-5 w-5" />}
      title={title}
      ariaLabel={title}
      testId="starter-template-card"
      description={template.displayDescription ?? ''}
      tags={template.tags.slice(0, MAX_TAGS)}
      iconColor={accent.iconColor}
      borderColor={accent.borderColor}
      previewFable={builder}
      onClick={() =>
        navigate({
          to: '/configure',
          search: templateConfigureSearch(template),
        })
      }
    />
  )
}

/** Placeholder matching the card's box, so nothing shifts when data lands. */
export function TemplateStarterCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-lg border bg-card p-5">
      <Skeleton className="mb-4 h-10 w-10 rounded-lg" />
      <Skeleton className="mb-2 h-5 w-2/3" />
      <Skeleton className="mb-4 h-12 w-full" />
      <Skeleton className="mb-4 h-20 w-full" />
      <div className="mt-auto flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  )
}
