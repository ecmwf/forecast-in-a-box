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
 * Lists currently-running lens instances reported by the backend manager,
 * regardless of whether they were spawned by the frontend. Each running
 * instance gets two actions: "Open" mounts our in-app WMS viewer against the
 * lens port, and "Copy WMS URL" copies the GetCapabilities URL to clipboard
 * for use in external WMS clients (QGIS, ArcGIS, etc.).
 *
 * Instances in a terminal state are surfaced read-only with a Stop action so
 * the user can clean them up.
 */

import { Suspense, lazy, useState } from 'react'
import { Copy, Map, Maximize2, Minimize2, Radar, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  LensInstanceDetailResponse,
  LensStatus,
} from '@/api/types/lens.types'
import { useLensList, useStopLens } from '@/api/hooks/useLens'
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
import { P } from '@/components/base/typography'

const WmsViewer = lazy(() => import('./WmsViewer'))

const LENS_STATUS_CLASS: Record<LensStatus, string> = {
  running:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  starting:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  terminated:
    'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
}

export function ActiveLensesCard() {
  const { t } = useTranslation('executions')
  const { data: lenses } = useLensList()
  const stopMutation = useStopLens()
  const [active, setActive] = useState<{
    baseUrl: string
    title: string
  } | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (!lenses || lenses.length === 0) return null

  return (
    <>
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-muted-foreground" />
          <P className="font-medium">{t('activeLenses.title')}</P>
        </div>
        <ul className="divide-y divide-border">
          {lenses.map((lens) => (
            <ActiveLensRow
              key={lens.lens_instance_id}
              lens={lens}
              onOpen={(baseUrl, title) => setActive({ baseUrl, title })}
              onStop={(id) => {
                stopMutation.mutate(
                  { lensInstanceId: id },
                  {
                    onError: (err) => showToast.error(err.message),
                  },
                )
              }}
              isStopping={stopMutation.isPending}
            />
          ))}
        </ul>
      </Card>
      <Sheet
        open={!!active}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null)
            setExpanded(false)
          }
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          style={{ height: expanded ? '95vh' : '50vh' }}
          className="flex flex-col gap-0 p-0 duration-300 data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full"
        >
          <SheetHeader className="flex flex-row items-start gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <SheetTitle>{t('lens.title')}</SheetTitle>
              <SheetDescription className="truncate font-mono text-xs">
                {active?.title}
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
          {active && (
            <Suspense fallback={null}>
              <WmsViewer baseUrl={active.baseUrl} />
            </Suspense>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function ActiveLensRow({
  lens,
  onOpen,
  onStop,
  isStopping,
}: {
  lens: LensInstanceDetailResponse
  onOpen: (baseUrl: string, title: string) => void
  onStop: (lensInstanceId: string) => void
  isStopping: boolean
}) {
  const { t } = useTranslation('executions')
  const path =
    typeof lens.lens_params.local_path === 'string'
      ? lens.lens_params.local_path
      : '—'
  const hasPort = lens.ports.length > 0
  const port = hasPort ? lens.ports[0] : null
  const canOpen = lens.status === 'running' && hasPort

  const copyUrl = () => {
    if (port === null) return
    const url = buildWmsCapabilitiesUrl(port)
    void navigator.clipboard.writeText(url).then(
      () => showToast.success(t('storedOutputs.wmsUrlCopied')),
      () => showToast.error(t('storedOutputs.wmsUrlCopyFailed')),
    )
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <P className="text-sm font-medium">{lens.lens_name}</P>
          <span
            className={cn(
              'rounded px-1.5 py-px text-xs',
              LENS_STATUS_CLASS[lens.status],
            )}
          >
            {lens.status}
          </span>
          {port !== null && (
            <span className="font-mono text-xs text-muted-foreground">
              :{port}
            </span>
          )}
        </div>
        <P
          className="truncate font-mono text-xs text-muted-foreground"
          title={path}
        >
          {path}
        </P>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!canOpen}
        onClick={() => {
          if (port !== null) onOpen(buildLensBaseUrl(port), path)
        }}
        className="gap-1.5"
        title={t('activeLenses.open')}
      >
        <Map className="h-3.5 w-3.5" />
        {t('activeLenses.open')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canOpen}
        onClick={copyUrl}
        className="gap-1.5"
        title={t('storedOutputs.copyWmsUrl')}
      >
        <Copy className="h-3.5 w-3.5" />
        {t('storedOutputs.copyWmsUrl')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isStopping}
        onClick={() => onStop(lens.lens_instance_id)}
        title={t('activeLenses.stop')}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}
