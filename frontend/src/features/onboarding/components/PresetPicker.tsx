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
import type { TemplateEntry } from '@/features/dashboard/hooks/useTemplatePresets'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Chips a preset card has room for. */
const MAX_TAGS = 2

function CardShell({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[10px] border bg-card p-3 shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function TagChips({ tags }: { tags: ReadonlyArray<string> }) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-[5px]">
      {tags.slice(0, MAX_TAGS).map((tag) => (
        <span
          key={tag}
          className="rounded-[5px] border px-1.5 font-mono text-[9.5px] text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

/** The activate step's vignette: starter templates as selectable cards. */
export function PresetPicker({
  starters,
  isLoading,
  selected,
  onSelect,
}: {
  starters: ReadonlyArray<TemplateEntry>
  isLoading: boolean
  selected: number
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation('onboarding')

  if (isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="grid w-full max-w-115 grid-cols-2 gap-3">
          {[0, 1].map((index) => (
            <CardShell key={index}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </CardShell>
          ))}
        </div>
      </div>
    )
  }

  if (starters.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-10 text-center">
        <p className="text-sm text-muted-foreground">{t('activate.empty')}</p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div
        className={cn(
          'grid w-full gap-3',
          starters.length >= 3
            ? 'max-w-135 grid-cols-3'
            : 'max-w-115 grid-cols-2',
        )}
      >
        {starters.map((template, index) => (
          <button
            key={template.blueprintId}
            type="button"
            data-testid="onboarding-preset-card"
            aria-label={template.displayName ?? undefined}
            aria-pressed={selected === index}
            onClick={() => onSelect(index)}
            className={cn(
              'relative flex flex-col gap-1.5 rounded-[10px] border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary',
              selected === index && 'border-primary ring-1 ring-primary',
            )}
          >
            {index === 0 && (
              <span className="absolute -top-2 right-2 rounded-full bg-primary px-2 py-px text-[9.5px] font-semibold whitespace-nowrap text-primary-foreground">
                {t('activate.recommended')}
              </span>
            )}
            {/* Title reserves two lines so descriptions and tags line up */}
            <span className="line-clamp-2 min-h-8 text-xs leading-4 font-semibold">
              {template.displayName}
            </span>
            <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {template.displayDescription}
            </span>
            <div className="mt-auto">
              <TagChips tags={template.tags} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
