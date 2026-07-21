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
 * Running lens servers as addable sources (picker dialog and hub).
 * Basket-backed lenses stop via source removal; strays get a manual Stop.
 * Renders nothing while no lens runs.
 */

import { useMemo } from 'react'
import { CircleStop, Radar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryRef } from '../../entry-ref'
import { useLensPathIndex } from '../../hooks/useLensPathIndex'
import { useComparisonStore } from '../../stores/comparisonStore'
import { AddToComparisonButton } from '../AddToComparisonButton'
import { useLensList, useStopLens } from '@/api/hooks/useLens'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'

export function RunningLensList({ query = '' }: { query?: string }) {
  const { t } = useTranslation('visualise')
  const stopMutation = useStopLens()
  const basketEntries = useComparisonStore((s) => s.entries)
  const basketRefs = useMemo(
    () => new Set(basketEntries.map((e) => entryRef(e))),
    [basketEntries],
  )
  const { data: lenses } = useLensList()
  const pathIndex = useLensPathIndex()

  if (!lenses || lenses.length === 0) return null
  return (
    <section className="space-y-1">
      <P className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Radar className="h-3.5 w-3.5" />
        {t('picker.runningLenses')}
      </P>
      <ul className="divide-y divide-border">
        {lenses.map((lens) => {
          const path =
            typeof lens.lens_params.local_path === 'string'
              ? lens.lens_params.local_path
              : ''
          const match = path ? pathIndex.get(path) : undefined
          const rowRefs = [
            path ? entryRef({ kind: 'path', path, label: path }) : null,
            match
              ? entryRef({
                  kind: 'output',
                  jobId: match.jobId,
                  taskId: match.taskId,
                  blockId: match.blockId,
                  runName: '',
                  blockTitle: match.blockId,
                  runCreatedAt: match.runCreatedAt,
                })
              : null,
          ]
          const inBasket = rowRefs.some(
            (ref) => ref !== null && basketRefs.has(ref),
          )
          if (
            query &&
            !path.toLowerCase().includes(query) &&
            !lens.lens_name.toLowerCase().includes(query)
          ) {
            return null
          }
          return (
            <li
              key={lens.lens_instance_id}
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <P className="text-sm font-medium">{lens.lens_name}</P>
                <P className="font-mono text-xs break-all text-muted-foreground">
                  {path}
                </P>
              </div>
              <AddToComparisonButton
                disabled={!match}
                disabledReason={t('entry.noMatch')}
                entry={
                  match
                    ? {
                        kind: 'output',
                        jobId: match.jobId,
                        taskId: match.taskId,
                        blockId: match.blockId,
                        runName: '',
                        blockTitle: match.blockId,
                        runCreatedAt: match.runCreatedAt,
                      }
                    : { kind: 'path', path, label: path }
                }
              />
              {!inBasket && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={stopMutation.isPending}
                  onClick={() =>
                    stopMutation.mutate(
                      { lensInstanceId: lens.lens_instance_id },
                      { onError: (err) => showToast.error(err.message) },
                    )
                  }
                  aria-label={t('lens.stopOne')}
                  title={t('lens.stopOne')}
                >
                  <CircleStop className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
