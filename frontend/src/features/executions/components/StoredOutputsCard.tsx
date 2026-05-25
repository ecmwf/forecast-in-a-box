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
 * path. Each row exposes two actions:
 *  - "Open" — spawns a SkinnyWMS lens and mounts the in-app WMS viewer once
 *    it reaches `running`.
 *  - "Copy WMS URL" — also spawns a lens, but instead of opening the viewer
 *    expands a panel inline that surfaces the GetCapabilities URL with a
 *    copy button + a Close action that stops the lens. Lets the user wire
 *    SkinnyWMS into an external client (QGIS, ArcGIS, etc.).
 *
 * Sinks that don't carry a path (e.g. `MapPlotSink` which streams bytes back
 * through the run's outputs panel) are skipped.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import {
  Copy,
  FolderOpen,
  Info,
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
import { P } from '@/components/base/typography'

const WmsViewer = lazy(() => import('./WmsViewer'))

const PATH_KEYS = ['path', 'dir'] as const

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
  const [activeLens, setActiveLens] = useState<{
    id: string
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
              onLaunched={(id) => setActiveLens({ id, title: row.path })}
            />
          ))}
        </ul>
      </Card>
      {activeLens && (
        <Suspense fallback={null}>
          <LensRunner
            lensInstanceId={activeLens.id}
            title={activeLens.title}
            onClose={() => setActiveLens(null)}
          />
        </Suspense>
      )}
    </>
  )
}

function StoredOutputRowItem({
  row,
  onLaunched,
}: {
  row: StoredOutputRow
  onLaunched: (lensInstanceId: string) => void
}) {
  const { t } = useTranslation('executions')
  const startMutation = useStartSkinnyWms()
  const [copyLensId, setCopyLensId] = useState<string | null>(null)
  // Two buttons share one mutation — track which initiated to route the spinner.
  const [pendingSource, setPendingSource] = useState<'open' | 'copy' | null>(
    null,
  )

  const open = () => {
    setPendingSource('open')
    startMutation.mutate(
      { localPath: row.path },
      {
        onSuccess: (id) => onLaunched(id),
        onError: (err) => showToast.error(err.message),
        onSettled: () => setPendingSource(null),
      },
    )
  }

  const openCopyPanel = () => {
    if (copyLensId) return // panel already open for this row
    setPendingSource('copy')
    startMutation.mutate(
      { localPath: row.path },
      {
        onSuccess: (id) => setCopyLensId(id),
        onError: (err) => showToast.error(err.message),
        onSettled: () => setPendingSource(null),
      },
    )
  }

  const closeCopyPanel = () => setCopyLensId(null)

  const disabled = startMutation.isPending || !row.isAvailable
  const unavailableTitle = row.isAvailable
    ? undefined
    : t('storedOutputs.fileMissing')
  const openPending = startMutation.isPending && pendingSource === 'open'
  const copyButtonPending = startMutation.isPending && pendingSource === 'copy'

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <P className="text-sm font-medium">{row.factoryTitle}</P>
          <P
            className="truncate font-mono text-xs text-muted-foreground"
            title={row.path}
          >
            {row.path}
          </P>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={open}
          disabled={disabled}
          className="gap-1.5"
          title={unavailableTitle ?? t('storedOutputs.open')}
        >
          {openPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Map className="h-3.5 w-3.5" />
          )}
          {t('storedOutputs.open')}
        </Button>
        <Button
          size="sm"
          variant={copyLensId ? 'default' : 'outline'}
          onClick={openCopyPanel}
          disabled={disabled || !!copyLensId}
          className="gap-1.5"
          title={unavailableTitle ?? t('storedOutputs.copyWmsUrl')}
        >
          {copyButtonPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {t('storedOutputs.copyWmsUrl')}
        </Button>
      </div>
      {copyLensId && (
        <CopyUrlPanel lensInstanceId={copyLensId} onClose={closeCopyPanel} />
      )}
    </li>
  )
}

/**
 * Inline panel rendered below the row when "Copy WMS URL" is clicked.
 * Polls lens status and surfaces the GetCapabilities URL once running;
 * Close stops the lens via the manager so the gunicorn process is
 * actually torn down (not just hidden from the panel).
 */
function CopyUrlPanel({
  lensInstanceId,
  onClose,
}: {
  lensInstanceId: string
  onClose: () => void
}) {
  const { t } = useTranslation('executions')
  const statusQuery = useLensStatus(lensInstanceId)
  const stopMutation = useStopLens()

  const status = statusQuery.data?.status
  const port = statusQuery.data?.ports[0]
  const running = status === 'running' && port !== undefined
  const failed =
    statusQuery.isError || status === 'failed' || status === 'terminated'
  const url = running ? buildWmsCapabilitiesUrl(port) : null

  const close = () => {
    stopMutation.mutate(
      { lensInstanceId },
      { onError: (err) => showToast.error(err.message) },
    )
    onClose()
  }

  const copy = () => {
    if (!url) return
    void navigator.clipboard.writeText(url).then(
      () => showToast.success(t('storedOutputs.wmsUrlCopied')),
      () => showToast.error(t('storedOutputs.wmsUrlCopyFailed')),
    )
  }

  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-2">
        <P className="font-medium">{t('storedOutputs.externalTitle')}</P>
        <P className="text-muted-foreground">
          {t('storedOutputs.externalHint')}
        </P>
        {failed ? (
          <P className="font-medium text-destructive">
            {statusQuery.error?.message ?? t('storedOutputs.lensFailed')}
          </P>
        ) : !running ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('storedOutputs.starting')}
          </div>
        ) : (
          <code
            className="block w-full overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs"
            title={url ?? undefined}
          >
            {url}
          </code>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={copy}
            disabled={!running}
            className="gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('storedOutputs.copyWmsUrl')}
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            {t('storedOutputs.closeAndStop')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Polls the lens status once started; mounts the WMS viewer when the
 * instance reaches `running`. Lens cleanup happens through explicit close
 * paths only (close button, sheet onOpenChange) — we avoid an unmount-time
 * stop because React StrictMode's dev mount → unmount → mount cycle would
 * otherwise tear down the freshly-spawned lens before the first poll.
 * Orphans surface in `ActiveLensesCard` for manual cleanup, and
 * `shutdown_all_lens_instances` catches anything on backend shutdown.
 */
function LensRunner({
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
  const stopMutation = useStopLens()
  const [expanded, setExpanded] = useState(false)

  const close = () => {
    stopMutation.mutate(
      { lensInstanceId },
      { onError: (err) => showToast.error(err.message) },
    )
    onClose()
  }

  const status = statusQuery.data?.status
  const port = statusQuery.data?.ports[0]
  const inFailedState =
    statusQuery.isError || status === 'failed' || status === 'terminated'

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        style={{ height: expanded ? '95vh' : '50vh' }}
        // Override the default ~40px slide with a full-height slide-up
        // for the map viewer — the panel is much taller than a typical
        // sheet, so the larger animation reads as intentional rather
        // than a glitch.
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
            <Button variant="outline" onClick={close}>
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
