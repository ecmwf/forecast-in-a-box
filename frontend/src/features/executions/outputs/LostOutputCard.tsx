/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Produced output that is no longer retrievable. Mirrors OutputCard
 * dimensions so the grid doesn't reflow; reads terminal, not pending. */

import { useTranslation } from 'react-i18next'
import { CloudOff } from 'lucide-react'
import { P } from '@/components/base/typography'

interface LostOutputCardProps {
  originalBlock: string
  /** Backend reason, shown verbatim. */
  reason: string
}

export function LostOutputCard({ originalBlock, reason }: LostOutputCardProps) {
  const { t } = useTranslation('executions')
  return (
    <div className="w-full space-y-2 overflow-hidden rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex aspect-video w-full items-center justify-center rounded bg-muted/40">
        <CloudOff className="h-8 w-8 text-muted-foreground/60" />
      </div>
      <div className="space-y-1">
        <P className="text-sm font-medium text-muted-foreground">
          {t('outputs.lostTitle')}
        </P>
        <P
          className="truncate font-mono text-xs text-muted-foreground/70"
          title={originalBlock}
        >
          {originalBlock}
        </P>
        <P className="text-xs text-muted-foreground italic" title={reason}>
          {reason}
        </P>
      </div>
    </div>
  )
}
