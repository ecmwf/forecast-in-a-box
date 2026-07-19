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
 * Lists sink outputs written to disk, derived from the run's own outputs:
 * GribSink streams its (run-private, glyph-resolved) output directory as a
 * `GRIB_DIR_MIME` payload. "Visualise" opens the output on /visualise (a
 * lens is started there as needed); the copy action copies the
 * GetCapabilities URL for external WMS clients (QGIS, ArcGIS, …). The lens
 * lifecycle is explicit on the row: a running server shows a Stop control.
 */

import { useEffect, useMemo, useState } from 'react'
import { Copy, Earth, FolderOpen, Loader2, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { RunOutputs } from '@/api/types/job.types'
import { getFactory } from '@/api/types/fable.types'
import {
  useLensStatus,
  useSkinnyWmsAvailable,
  useStartSkinnyWms,
  useStopLens,
} from '@/api/hooks/useLens'
import { buildWmsCapabilitiesUrl } from '@/api/endpoints/lens'
import { useStoredDirPath } from '@/features/executions/outputs/stored-dir'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'
import { AddToComparisonButton } from '@/features/compare/components/AddToComparisonButton'
import { SLOT_B_OFF, entryRef } from '@/features/compare/entry-ref'
import { showToast } from '@/lib/toast'
import { cn, copyToClipboard } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

const GRIB_CHIP_CLASS =
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'

/** Split "/a/b/dirname" into the dimmed parent and emphasized last segment. */
function splitPath(path: string): { dir: string; name: string } {
  const trimmed = path.replace(/\/$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return { dir: '', name: trimmed }
  return { dir: trimmed.slice(0, idx + 1), name: trimmed.slice(idx + 1) }
}

interface StoredOutputsCardProps {
  jobId: string
  outputs: RunOutputs | null
  /** Optional: resolve human-readable sink titles from the run's fable. */
  fable?: FableBuilderV1
  catalogue?: BlockFactoryCatalogue
  /** Blueprint display name — snapshotted into comparison entries. */
  runName?: string
}

interface StoredOutputRow {
  blockId: string
  /** Representative marker task for this sink block (payload source). */
  taskId: string
  title: string
  isAvailable: boolean
  /** Number of GRIB marker tasks the sink fanned out to. */
  count: number
}

export function StoredOutputsCard({
  jobId,
  outputs,
  fable,
  catalogue,
  runName,
}: StoredOutputsCardProps) {
  const { t } = useTranslation('executions')

  // One row per sink block — a sink fans out to one marker task per cascade
  // branch (e.g. per ensemble member), all pointing at the same directory.
  const rows = useMemo<Array<StoredOutputRow>>(() => {
    if (!outputs) return []
    const byBlock = new Map<string, StoredOutputRow>()
    for (const [taskId, meta] of Object.entries(outputs)) {
      if (meta.mime_type !== GRIB_DIR_MIME) continue
      const existing = byBlock.get(meta.original_block)
      if (existing) {
        existing.count += 1
        // Prefer an available marker as the representative payload source.
        if (!existing.isAvailable && meta.is_available) {
          existing.taskId = taskId
          existing.isAvailable = true
        }
        continue
      }
      const blockInstance = fable?.blocks[meta.original_block]
      const factory =
        catalogue && blockInstance
          ? getFactory(catalogue, blockInstance.factory_id)
          : undefined
      byBlock.set(meta.original_block, {
        blockId: meta.original_block,
        taskId,
        title: factory?.title ?? meta.original_block,
        isAvailable: meta.is_available,
        count: 1,
      })
    }
    return Array.from(byBlock.values())
  }, [outputs, fable, catalogue])

  if (rows.length === 0) return null

  return (
    <Card shadow="none" className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <P className="font-medium">{t('storedOutputs.title')}</P>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <StoredOutputRowItem
            key={row.blockId}
            jobId={jobId}
            row={row}
            runName={runName}
          />
        ))}
      </ul>
    </Card>
  )
}

function StoredOutputRowItem({
  jobId,
  row,
  runName,
}: {
  jobId: string
  row: StoredOutputRow
  runName?: string
}) {
  const { t } = useTranslation('executions')
  // false only when the backend reports SkinnyWMS as not installed.
  const wmsUnavailable = useSkinnyWmsAvailable() === false
  const startMutation = useStartSkinnyWms()
  const stopMutation = useStopLens()
  const dirQuery = useStoredDirPath(jobId, row.taskId, row.isAvailable)
  const dirPath = dirQuery.data
  // The row owns its lens instance; the viewer sheet only displays it.
  const [lensId, setLensId] = useState<string | null>(null)
  const statusQuery = useLensStatus(lensId ?? undefined)

  const status = lensId ? statusQuery.data?.status : undefined
  const port = lensId ? statusQuery.data?.ports[0] : undefined
  const running = status === 'running' && port !== undefined
  const failed =
    !!lensId &&
    (statusQuery.isError || status === 'failed' || status === 'terminated')

  const copyUrl = (lensPort: number) => {
    void navigator.clipboard.writeText(buildWmsCapabilitiesUrl(lensPort)).then(
      () => showToast.success(t('storedOutputs.wmsUrlCopied')),
      () => showToast.error(t('storedOutputs.wmsUrlCopyFailed')),
    )
  }

  const copyPath = (path: string) => {
    void copyToClipboard(path).then((ok) =>
      ok
        ? showToast.success(t('storedOutputs.pathCopied'))
        : showToast.error(t('storedOutputs.pathCopyFailed')),
    )
  }

  // Surface a failed launch once, then reset so the user can retry.
  useEffect(() => {
    if (!failed) return
    showToast.error(statusQuery.error?.message ?? t('storedOutputs.lensFailed'))
    setLensId(null)
  }, [failed])

  /** Start the SkinnyWMS lens on the resolved directory. */
  const startServer = () => {
    if (lensId || !dirPath) return
    startMutation.mutate(
      { localPath: dirPath },
      {
        onSuccess: (id) => setLensId(id),
        onError: (err) => showToast.error(err.message),
      },
    )
  }

  const navigate = useNavigate()
  const visualise = () => {
    void navigate({
      to: '/visualise',
      search: {
        a: entryRef({
          kind: 'output',
          jobId,
          taskId: row.taskId,
          blockId: row.blockId,
          runName: runName ?? '',
          blockTitle: row.title,
          runCreatedAt: null,
        }),
        // Deliberate single view of THIS output — no basket auto-pair.
        b: SLOT_B_OFF,
      },
    })
  }

  const copy = () => {
    if (port !== undefined) copyUrl(port)
  }

  const stop = () => {
    if (!lensId) return
    stopMutation.mutate(
      { lensInstanceId: lensId },
      { onError: (err) => showToast.error(err.message) },
    )
    setLensId(null)
  }

  const isStarting = startMutation.isPending || (!!lensId && !running)
  const startDisabled = wmsUnavailable || !dirPath || isStarting
  const startTitle = wmsUnavailable
    ? t('storedOutputs.wmsUnavailable')
    : t('storedOutputs.startWms')
  const { dir, name } = dirPath ? splitPath(dirPath) : { dir: '', name: '' }

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
          GRIB_CHIP_CLASS,
        )}
      >
        GRIB
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <P className="truncate text-sm font-medium">{row.title}</P>
          {row.count > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('storedOutputs.fileCount', { n: row.count })}
            </span>
          )}
        </div>
        {dirPath ? (
          <button
            type="button"
            onClick={() => copyPath(dirPath)}
            className="group/path flex w-full min-w-0 items-center gap-1 text-left font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            title={t('storedOutputs.copyPath')}
          >
            <span className="truncate">
              {dir}
              <span className="text-foreground/80">{name}</span>
            </span>
            <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-70" />
          </button>
        ) : row.isAvailable ? (
          <P className="font-mono text-xs text-muted-foreground">…</P>
        ) : (
          <P className="text-xs text-muted-foreground italic">
            {t('storedOutputs.fileMissing')}
          </P>
        )}
        {/* Inline note: disabled buttons can't surface a title/tooltip. */}
        {wmsUnavailable && (
          <P className="text-xs text-muted-foreground italic">
            {t('storedOutputs.wmsUnavailable')}
          </P>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AddToComparisonButton
          entry={{
            kind: 'output',
            jobId,
            taskId: row.taskId,
            blockId: row.blockId,
            runName: runName ?? '',
            blockTitle: row.title,
            runCreatedAt: null,
          }}
          disabled={!row.isAvailable}
        />
        {row.isAvailable && (
          <Button
            size="sm"
            variant="outline"
            onClick={visualise}
            className="gap-1.5"
          >
            <Earth className="h-3.5 w-3.5" />
            {t('storedOutputs.visualise')}
          </Button>
        )}
        {!row.isAvailable ? null : running ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={stop}
              disabled={stopMutation.isPending}
              className="gap-1.5"
            >
              <Square className="h-3.5 w-3.5" />
              {t('storedOutputs.stopWms')}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copy}
                    className="gap-1.5"
                    aria-label={t('storedOutputs.copyWmsUrl')}
                  />
                }
              >
                <Copy className="h-3.5 w-3.5" />
                {t('storedOutputs.copy')}
              </TooltipTrigger>
              <TooltipContent>
                <P className="max-w-xs text-xs text-inherit">
                  <span className="font-medium">
                    {t('storedOutputs.externalTitle')}
                  </span>
                  <br />
                  {t('storedOutputs.externalHint')}
                </P>
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={startServer}
            disabled={startDisabled}
            className="gap-1.5"
            title={startTitle}
          >
            {isStarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isStarting
              ? t('storedOutputs.startingWms')
              : t('storedOutputs.startWms')}
          </Button>
        )}
      </div>
    </li>
  )
}

