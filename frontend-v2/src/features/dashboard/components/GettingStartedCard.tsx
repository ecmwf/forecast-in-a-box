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
 * GettingStartedCard Component
 *
 * Individual card for getting started options
 */

import type { ReactNode } from 'react'
import { H3, P } from '@/components/base/typography'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface GettingStartedCardProps {
  icon: ReactNode
  title: string
  description: string
  tags: Array<string>
  isRecommended?: boolean
  disabled?: boolean
  disabledMessage?: string
  iconColor?: string
  borderColor?: string
  onClick?: () => void
}

export function GettingStartedCard({
  icon,
  title,
  description,
  tags,
  isRecommended = false,
  disabled = false,
  disabledMessage,
  iconColor = 'bg-primary/10 text-primary',
  borderColor = 'border-border hover:border-blue-400',
  onClick,
}: GettingStartedCardProps) {
  const card = (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        'relative flex h-full flex-col rounded-lg border p-5 transition-colors',
        'bg-card',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        disabled
          ? 'border-border'
          : isRecommended
            ? 'border-2 border-primary/20 bg-muted/50 hover:border-primary'
            : borderColor,
      )}
    >
      {isRecommended && (
        <div className="absolute top-4 right-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
          Recommended
        </div>
      )}

      <div
        className={cn(
          'mb-4 flex h-10 w-10 items-center justify-center rounded-lg',
          iconColor,
        )}
      >
        {icon}
      </div>

      <H3 className="mb-2 text-base font-bold">{title}</H3>
      <P className="mb-4 leading-relaxed text-muted-foreground">
        {description}
      </P>

      <div className="mt-auto flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <span
            key={index}
            className={cn(
              'rounded px-2 py-1 text-sm text-muted-foreground',
              isRecommended
                ? 'border border-border bg-card dark:bg-card'
                : 'bg-muted',
            )}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  )

  if (disabled && disabledMessage) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>{card}</TooltipTrigger>
        <TooltipContent>{disabledMessage}</TooltipContent>
      </Tooltip>
    )
  }

  return card
}
