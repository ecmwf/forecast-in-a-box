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
 * Soft warning for a blueprint built on a different fiab-core major
 * (backend `CoreVersionMismatch` tag). Parses the detail (e.g. "!3 != 4")
 * into a readable tooltip; falls back to a generic message.
 */

import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function parseMismatch(
  detail: string,
): { stored: string; current: string } | null {
  const m = /(\d+)\s*!=\s*(\d+)/.exec(detail)
  return m ? { stored: m[1], current: m[2] } : null
}

interface CoreVersionMismatchBadgeProps {
  /** Backend `CoreVersionMismatch` tag value, e.g. "!3 != 4". */
  detail: string
  className?: string
}

export function CoreVersionMismatchBadge({
  detail,
  className,
}: CoreVersionMismatchBadgeProps) {
  const { t } = useTranslation('common')
  const parsed = parseMismatch(detail)
  const tooltip = parsed
    ? t('coreVersionMismatch.detail', parsed)
    : t('coreVersionMismatch.detailUnknown')

  return (
    <Tooltip>
      <TooltipTrigger>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
            'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
            className,
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('coreVersionMismatch.label')}
        </span>
      </TooltipTrigger>
      {/* Plain text: inherits the popup's light color; a <P> would force
          dark `text-foreground` and vanish on the dark background. */}
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
