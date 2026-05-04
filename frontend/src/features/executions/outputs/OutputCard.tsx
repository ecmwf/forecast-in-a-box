/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OutputAdapter, OutputItem } from './types'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface OutputCardProps {
  item: OutputItem
  adapter: OutputAdapter
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
}

export function OutputCard({ item, adapter, onOpenViewer }: OutputCardProps) {
  const { t } = useTranslation('executions')
  const { Thumbnail, Viewer, icon: Icon, actions } = adapter
  const shortLabel = (adapter.shortLabel ?? adapter.label)(t)
  const filename = `${item.originalBlock}.${adapter.extension}`

  const handleOpenViewer = () => {
    if (Viewer) onOpenViewer(item, adapter)
  }

  const visibleActions = actions.filter((a) => a.isAvailable?.(item) ?? true)

  return (
    <div className="w-full space-y-2 overflow-hidden rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
      <div
        className={Viewer ? 'relative cursor-pointer' : 'relative'}
        role={Viewer ? 'button' : undefined}
        tabIndex={Viewer ? 0 : undefined}
        onClick={handleOpenViewer}
        onKeyDown={(e) => {
          if (Viewer && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpenViewer(item, adapter)
          }
        }}
      >
        {Thumbnail ? (
          <Thumbnail item={item} adapter={adapter} />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded bg-muted">
            <Icon className="h-8 w-8 text-muted-foreground" />
          </div>
        )}

        {/* MIME pill in the top-left corner of the thumbnail. Color-coded
            per adapter so users can scan formats at a glance. */}
        <span
          className={cn(
            'pointer-events-none absolute top-2 left-2 rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
            adapter.chipClass,
          )}
        >
          {shortLabel}
        </span>
      </div>

      <div className="space-y-0.5">
        <P className="truncate font-medium" title={filename}>
          {filename}
        </P>
        <P
          className="truncate font-mono text-xs text-muted-foreground/70"
          title={item.taskId}
        >
          {item.originalBlock}
        </P>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Viewer && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenViewer}
            title={t('outputs.actions.view')}
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
        {visibleActions.map((action) => {
          const ActionIcon = action.icon
          return (
            <Button
              key={action.id}
              size="sm"
              variant={action.variant ?? 'outline'}
              onClick={() =>
                void action.run(item, { resolvedAdapter: adapter })
              }
              title={action.label(t)}
            >
              <ActionIcon className="h-3 w-3" />
            </Button>
          )
        })}
      </div>
    </div>
  )
}
