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

import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DragEvent, ReactNode } from 'react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
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
  /** Accessible name; without it the whole subtree is read out on focus. */
  ariaLabel?: string
  testId?: string
  isRecommended?: boolean
  disabled?: boolean
  disabledMessage?: string
  iconColor?: string
  borderColor?: string
  /** When provided, renders a colour mini-flow preview under the description. */
  previewFable?: FableBuilderV1
  onClick?: () => void
  /** When provided, a file dropped on the card is handed over. */
  onFileDrop?: (file: File) => void
  /** Shown over the card while a file is dragged over it. */
  dropLabel?: string
}

const isFileDrag = (event: DragEvent) =>
  event.dataTransfer.types.includes('Files')

export function GettingStartedCard({
  icon,
  title,
  description,
  tags,
  ariaLabel,
  testId,
  isRecommended = false,
  disabled = false,
  disabledMessage,
  iconColor = 'bg-primary/10 text-primary',
  borderColor = 'border-border hover:border-blue-400',
  previewFable,
  onClick,
  onFileDrop,
  dropLabel,
}: GettingStartedCardProps) {
  const { t } = useTranslation('dashboard')
  const [isDragOver, setIsDragOver] = useState(false)
  const dropHandlers =
    onFileDrop && !disabled
      ? {
          onDragEnter: (event: DragEvent<HTMLDivElement>) => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            setIsDragOver(true)
          },
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          },
          onDragLeave: (event: DragEvent<HTMLDivElement>) => {
            // Moving onto a child also fires dragleave on the card.
            if (event.currentTarget.contains(event.relatedTarget as Node))
              return
            setIsDragOver(false)
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            setIsDragOver(false)
            const file = event.dataTransfer.files.item(0)
            if (file) onFileDrop(file)
          },
        }
      : {}
  const card = (
    <div
      role="button"
      aria-label={ariaLabel}
      data-testid={testId}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      {...dropHandlers}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault() // Space scrolls the page by default
          onClick?.()
        }
      }}
      className={cn(
        'relative flex h-full flex-col rounded-lg border p-5 transition-colors',
        'bg-card',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        disabled
          ? 'border-border'
          : isRecommended
            ? 'border-2 border-primary/20 bg-muted/50 hover:border-primary'
            : borderColor,
        isDragOver && 'border-dashed border-primary',
      )}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-card/90 text-sm font-medium text-primary">
          <FileUp className="h-5 w-5" />
          {dropLabel}
        </div>
      )}
      {isRecommended && (
        <div className="absolute top-4 right-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
          {t('gettingStarted.recommended')}
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
      {/* Clamped so plugin-authored copy of any length keeps the grid aligned. */}
      <P className="mb-4 line-clamp-2 leading-relaxed text-muted-foreground">
        {description}
      </P>

      {previewFable && !disabled && (
        <div className="mb-4">
          <FableMiniFlow builder={previewFable} monochrome={false} />
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              'rounded-md px-2 py-1 text-sm text-muted-foreground',
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
