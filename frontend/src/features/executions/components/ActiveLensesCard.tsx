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
 * Running lens servers on the run list: jump into the viewer with the
 * lens as source A, or stop the instance. Hidden while nothing runs.
 */

import { CircleStop, Earth, Radar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useLensList, useStopLens } from '@/api/hooks/useLens'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'
import { SLOT_B_OFF, entryRef } from '@/features/visualise/entry-ref'
import { useLensPathIndex } from '@/features/visualise/hooks/useLensPathIndex'

export function ActiveLensesCard() {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const { data: lenses } = useLensList()
  const pathIndex = useLensPathIndex()
  const stopMutation = useStopLens()
  if (!lenses || lenses.length === 0) return null

  return (
    <Card className="space-y-2 p-4">
      <P className="flex items-center gap-1.5 text-sm font-medium">
        <Radar className="h-4 w-4 text-muted-foreground" />
        {t('activeLenses.title')}
      </P>
      <ul className="divide-y divide-border">
        {lenses.map((lens) => {
          const path =
            typeof lens.lens_params.local_path === 'string'
              ? lens.lens_params.local_path
              : ''
          const match = path ? pathIndex.get(path) : undefined
          // Prefer the run-backed ref — the viewer then shows run labels.
          const ref = match
            ? entryRef({
                kind: 'output',
                jobId: match.jobId,
                taskId: match.taskId,
                blockId: match.blockId,
                runName: '',
                blockTitle: match.blockId,
                runCreatedAt: match.runCreatedAt,
              })
            : path
              ? entryRef({ kind: 'path', path, label: path })
              : null
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
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={ref === null}
                onClick={() => {
                  if (ref === null) return
                  void navigate({
                    to: '/visualise',
                    search: { a: ref, b: SLOT_B_OFF },
                  })
                }}
              >
                <Earth className="h-3.5 w-3.5" />
                {t('activeLenses.visualise')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={stopMutation.isPending}
                onClick={() =>
                  stopMutation.mutate(
                    { lensInstanceId: lens.lens_instance_id },
                    { onError: (err) => showToast.error(err.message) },
                  )
                }
              >
                <CircleStop className="h-3.5 w-3.5" />
                {t('activeLenses.stop')}
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
