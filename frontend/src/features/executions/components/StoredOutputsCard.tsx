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
 * `GRIB_DIR_MIME` payload, which this card fetches and serves to a SkinnyWMS
 * lens. "Open" mounts the in-app WMS viewer, the copy action copies the
 * GetCapabilities URL for external WMS clients (QGIS, ArcGIS, …). The lens
 * lifecycle is explicit on the row: a running server shows a status badge
 * with its port and a Stop control; closing the viewer sheet does not stop
 * the server.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  FolderOpen,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
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
import { buildLensBaseUrl, buildWmsCapabilitiesUrl } from '@/api/endpoints/lens'
import { getJobResultHead } from '@/api/endpoints/job'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'
import { showToast } from '@/lib/toast'
import { cn, copyToClipboard } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

const WmsViewer = lazy(() => import('./WmsViewer'))

/** The directory payload is a short path — cap the fetch defensively. */
const DIR_PAYLOAD_BYTES = 1024

const GRIB_CHIP_CLASS =
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'

/** Split "/a/b/dirname" into the dimmed parent and emphasized last segment. */
function splitPath(path: string): { dir: string; name: string } {
  const trimmed = path.replace(/\/$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return { dir: '', name: trimmed }
  return { dir: trimmed.slice(0, idx + 1), name: trimmed.slice(idx + 1) }
}

/** Resolve the lens directory for a marker output: its payload holds the
 * glyph-resolved output directory as plain text, written by the backend. */
function useStoredDirPath(jobId: string, taskId: string, enabled: boolean) {
  return useQuery<string>({
    queryKey: ['job-result', 'stored-dir', jobId, taskId],
    queryFn: async () => {
      const head = await getJobResultHead(jobId, taskId, DIR_PAYLOAD_BYTES)
      return new TextDecoder().decode(head).trim()
    },
    enabled,
    staleTime: Infinity,
    retry: 1,
  })
}

interface StoredOutputsCardProps {
  jobId: string
  outputs: RunOutputs | null
  /** Optional: resolve human-readable sink titles from the run's fable. */
  fable?: FableBuilderV1
  catalogue?: BlockFactoryCatalogue
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
}: StoredOutputsCardProps) {
  const { t } = useTranslation('executions')
  const [viewer, setViewer] = useState<{
    lensId: string
    title: string
  } | null>(null)

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
    <>
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
              onOpenViewer={(lensId, title) => setViewer({ lensId, title })}
            />
          ))}
        </ul>
      </Card>
      {viewer && (
        <Suspense fallback={null}>
          <LensViewerSheet
            lensInstanceId={viewer.lensId}
            title={viewer.title}
            onClose={() => setViewer(null)}
          />
        </Suspense>
      )}
    </>
  )
}

function StoredOutputRowItem({
  jobId,
  row,
  onOpenViewer,
}: {
  jobId: string
  row: StoredOutputRow
  onOpenViewer: (lensId: string, title: string) => void
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
  // Copy requested before the server was up — fulfilled once it is.
  const pendingCopy = useRef(false)

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

  useEffect(() => {
    if (running && pendingCopy.current) {
      pendingCopy.current = false
      copyUrl(port)
    }
  }, [running, port])

  // Surface a failed launch once, then reset so the user can retry.
  useEffect(() => {
    if (!failed) return
    pendingCopy.current = false
    showToast.error(statusQuery.error?.message ?? t('storedOutputs.lensFailed'))
    setLensId(null)
  }, [failed])

  /** Start the lens on the resolved directory, then hand the id to `then`. */
  const ensureLens = (then?: (id: string) => void) => {
    if (lensId) {
      then?.(lensId)
      return
    }
    if (!dirPath) return
    startMutation.mutate(
      { localPath: dirPath },
      {
        onSuccess: (id) => {
          setLensId(id)
          then?.(id)
        },
        onError: (err) => {
          pendingCopy.current = false
          showToast.error(err.message)
        },
      },
    )
  }

  const open = () => ensureLens((id) => onOpenViewer(id, dirPath ?? row.title))

  const copy = () => {
    if (running) {
      copyUrl(port)
      return
    }
    pendingCopy.current = true
    ensureLens()
  }

  const stop = () => {
    if (!lensId) return
    stopMutation.mutate(
      { lensInstanceId: lensId },
      { onError: (err) => showToast.error(err.message) },
    )
    setLensId(null)
  }

  const disabled =
    startMutation.isPending || !row.isAvailable || !dirPath || wmsUnavailable
  const unavailableTitle = wmsUnavailable
    ? t('storedOutputs.wmsUnavailable')
    : row.isAvailable
      ? undefined
      : t('storedOutputs.fileMissing')
  const { dir, name } = dirPath ? splitPath(dirPath) : { dir: '', name: '' }
  const starting = !!lensId && !running

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
        {lensId && (
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                running ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
              )}
            />
            <span className="text-muted-foreground">
              {running
                ? `${t('storedOutputs.running')} :${port}`
                : t('storedOutputs.starting')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs"
              onClick={stop}
            >
              {t('storedOutputs.stop')}
            </Button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={open}
          disabled={disabled}
          className="gap-1.5"
          title={unavailableTitle ?? t('storedOutputs.open')}
        >
          {startMutation.isPending || starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapIcon className="h-3.5 w-3.5" />
          )}
          {t('storedOutputs.open')}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={copy}
                disabled={disabled}
                aria-label={t('storedOutputs.copyWmsUrl')}
              />
            }
          >
            <Copy className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>
            <P className="max-w-xs text-xs text-inherit">
              {wmsUnavailable ? (
                t('storedOutputs.wmsUnavailable')
              ) : (
                <>
                  <span className="font-medium">
                    {t('storedOutputs.externalTitle')}
                  </span>
                  <br />
                  {t('storedOutputs.externalHint')}
                </>
              )}
            </P>
          </TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

/**
 * Bottom sheet hosting the WMS viewer for a row-owned lens. Closing the
 * sheet only hides the viewer — the server keeps running and remains
 * stoppable from the row badge (and `ActiveLensesCard`).
 */
function LensViewerSheet({
  lensInstanceId,
  title,
  onClose,
}: {
  lensInstanceId: string
  title: string
  onClose: () => void
}) {
  const { t } = useTranslation('executions')
  const statusQuery = useLensStatus(lensInstanceId)
  const [expanded, setExpanded] = useState(false)

  const status = statusQuery.data?.status
  const port = statusQuery.data?.ports[0]
  const inFailedState =
    statusQuery.isError || status === 'failed' || status === 'terminated'

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        style={{ height: expanded ? '95vh' : '50vh' }}
        // Full-height slide-up: the panel is much taller than a default sheet.
        className="flex flex-col gap-0 p-0 duration-300 data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full"
      >
        <SheetHeader className="flex flex-row items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <SheetTitle>{t('lens.title')}</SheetTitle>
            {/* Hint + path share a line when wide; the path wraps below when cramped. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <SheetDescription className="shrink-0">
                {t('lens.subtitle')}
              </SheetDescription>
              <span
                className="min-w-0 grow basis-64 truncate font-mono text-xs text-muted-foreground"
                title={title}
              >
                {title}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? t('lens.collapse') : t('lens.expand')}
            title={expanded ? t('lens.collapse') : t('lens.expand')}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t('storedOutputs.close')}
              />
            }
          >
            <X className="h-3.5 w-3.5" />
          </SheetClose>
        </SheetHeader>
        {inFailedState ? (
          <div className="m-auto max-w-md space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
            <P className="font-semibold text-destructive">
              {t('storedOutputs.lensFailed')}
            </P>
            <P className="text-sm text-destructive/80">
              {statusQuery.error?.message ?? status ?? 'unknown'}
            </P>
            <Button variant="outline" onClick={onClose}>
              {t('storedOutputs.close')}
            </Button>
          </div>
        ) : status !== 'running' || port === undefined ? (
          <div className="m-auto flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t('storedOutputs.starting')}</span>
          </div>
        ) : (
          <WmsViewer baseUrl={buildLensBaseUrl(port)} />
        )}
      </SheetContent>
    </Sheet>
  )
}
