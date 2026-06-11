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
 * Lists sink blocks that wrote a file/directory to a configured filesystem
 * path. Each row can launch a SkinnyWMS lens for its file: "Open" mounts the
 * in-app WMS viewer, the copy action copies the GetCapabilities URL for
 * external WMS clients (QGIS, ArcGIS, …). The lens lifecycle is explicit on
 * the row: a running server shows a status badge with its port and a Stop
 * control; closing the viewer sheet does not stop the server.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  FolderOpen,
  Loader2,
  Map,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BlockFactoryCatalogue,
  BlockInstance,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { RunOutputs } from '@/api/types/job.types'
import { getFactory } from '@/api/types/fable.types'
import {
  useLensStatus,
  useStartSkinnyWms,
  useStopLens,
} from '@/api/hooks/useLens'
import { buildLensBaseUrl, buildWmsCapabilitiesUrl } from '@/api/endpoints/lens'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
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

const PATH_KEYS = ['path', 'dir'] as const

/** Format pill per file extension; mirrors the output-card chip palette. */
const FORMAT_CHIPS: ReadonlyArray<{
  re: RegExp
  label: string
  chipClass: string
}> = [
  {
    re: /\.grib2?$/i,
    label: 'GRIB',
    chipClass:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  {
    re: /\.zarr\/?$/i,
    label: 'ZARR',
    chipClass:
      'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  },
  {
    re: /\.nc$/i,
    label: 'NETCDF',
    chipClass: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  },
]

const FALLBACK_CHIP = {
  label: 'FILE',
  chipClass:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

function chipFor(path: string): { label: string; chipClass: string } {
  return FORMAT_CHIPS.find((c) => c.re.test(path)) ?? FALLBACK_CHIP
}

/** Split "/a/b/name.ext" into the dimmed directory and emphasized filename. */
function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/')
  if (idx < 0) return { dir: '', name: path }
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}

interface StoredOutputsCardProps {
  fable: FableBuilderV1
  catalogue: BlockFactoryCatalogue
  /** Server-authoritative path map from `run.outputs.stored`. When present,
   * overrides the fable-walk and contributes `is_available` for each file. */
  storedOutputs?: RunOutputs['stored']
}

interface StoredOutputRow {
  blockId: string
  factoryTitle: string
  path: string
  isAvailable: boolean
}

export function StoredOutputsCard({
  fable,
  catalogue,
  storedOutputs,
}: StoredOutputsCardProps) {
  const { t } = useTranslation('executions')
  const [viewer, setViewer] = useState<{
    lensId: string
    title: string
  } | null>(null)

  const rows = useMemo<Array<StoredOutputRow>>(() => {
    const out: Array<StoredOutputRow> = []
    for (const [blockId, instance] of Object.entries(fable.blocks)) {
      const factory = getFactory(catalogue, instance.factory_id)
      if (!factory || factory.kind !== 'sink') continue
      const stored = storedOutputs?.[blockId]
      const path = stored?.path ?? pickPath(instance)
      if (!path) continue
      // Server reports is_available via os.path.exists; fall back to true when
      // we're sourcing from the fable spec alone (no run-side knowledge).
      const isAvailable = stored?.is_available ?? true
      out.push({ blockId, factoryTitle: factory.title, path, isAvailable })
    }
    return out
  }, [fable, catalogue, storedOutputs])

  if (rows.length === 0) return null

  return (
    <>
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <P className="font-medium">{t('storedOutputs.title')}</P>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <StoredOutputRowItem
              key={row.blockId}
              row={row}
              onOpenViewer={(lensId) => setViewer({ lensId, title: row.path })}
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
  row,
  onOpenViewer,
}: {
  row: StoredOutputRow
  onOpenViewer: (lensId: string) => void
}) {
  const { t } = useTranslation('executions')
  const startMutation = useStartSkinnyWms()
  const stopMutation = useStopLens()
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

  /** Start the lens if needed, then hand the instance id to `then`. */
  const ensureLens = (then?: (id: string) => void) => {
    if (lensId) {
      then?.(lensId)
      return
    }
    startMutation.mutate(
      { localPath: row.path },
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

  const open = () => ensureLens((id) => onOpenViewer(id))

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

  const disabled = startMutation.isPending || !row.isAvailable
  const unavailableTitle = row.isAvailable
    ? undefined
    : t('storedOutputs.fileMissing')
  const chip = chipFor(row.path)
  const { dir, name } = splitPath(row.path)
  const starting = !!lensId && !running

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
          chip.chipClass,
        )}
      >
        {chip.label}
      </span>
      <div className="min-w-0 flex-1">
        <P className="truncate font-mono text-sm font-medium" title={row.path}>
          {name}
        </P>
        {dir && (
          <P className="truncate font-mono text-xs text-muted-foreground">
            {dir}
          </P>
        )}
        {!row.isAvailable && (
          <P className="text-xs text-muted-foreground italic">
            {t('storedOutputs.fileMissing')}
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
            <Map className="h-3.5 w-3.5" />
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
            <P className="max-w-xs text-xs">
              <span className="font-medium">
                {t('storedOutputs.externalTitle')}
              </span>
              <br />
              {t('storedOutputs.externalHint')}
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
            <SheetDescription className="truncate font-mono text-xs">
              {title}
            </SheetDescription>
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

function pickPath(instance: BlockInstance): string | null {
  for (const key of PATH_KEYS) {
    const value = instance.configuration_values[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}
