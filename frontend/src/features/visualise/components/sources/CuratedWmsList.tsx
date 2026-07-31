/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Known WMS servers, one click to probe and add (curated name as label). */

import { useMemo, useState } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CuratedWmsServer } from '@/features/visualise/curated-wms'
import { useCuratedWmsServers } from '@/features/visualise/curated-wms'
import { probeWmsEndpoint } from '@/features/visualise/wms-probe'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
} from '@/features/visualise/stores/comparisonStore'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'

export function CuratedWmsList() {
  const { t } = useTranslation('visualise')
  const servers = useCuratedWmsServers()
  const entries = useComparisonStore((s) => s.entries)
  const addEntry = useComparisonStore((s) => s.addEntry)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  // Probe stores URLs via `new URL(...).toString()` — match that form.
  const inBasket = useMemo(
    () => new Set(entries.flatMap((e) => (e.kind === 'wms' ? [e.url] : []))),
    [entries],
  )

  const add = async (server: CuratedWmsServer) => {
    if (busy.has(server.url)) return
    setBusy((prev) => new Set(prev).add(server.url))
    const result = await probeWmsEndpoint(server.url)
    setBusy((prev) => {
      const next = new Set(prev)
      next.delete(server.url)
      return next
    })
    if (!result.ok) {
      showToast.error(
        t(
          result.reason === 'timeout'
            ? 'picker.curated.timedOut'
            : 'picker.curated.failed',
          { name: server.name },
        ),
      )
      return
    }
    const added = addEntry({
      kind: 'wms',
      url: result.baseUrl,
      label: server.name,
    })
    if (added === 'added') {
      showToast.success(t('toast.added', { name: server.name }))
    } else if (added === 'full') {
      showToast.error(t('toast.full', { max: MAX_COMPARISON_ENTRIES }))
    }
  }

  return (
    <div className="space-y-1.5">
      <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('picker.curated.title')}
      </P>
      <ul className="max-h-56 divide-y divide-border overflow-y-auto">
        {servers.map((server) => {
          const added = inBasket.has(new URL(server.url).toString())
          const checking = busy.has(server.url)
          return (
            <li key={server.url} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <P className="truncate text-sm font-medium">{server.name}</P>
                {checking ? (
                  <P className="truncate text-[11px] text-muted-foreground">
                    {t('picker.curated.checking')}
                  </P>
                ) : (
                  <P
                    className="truncate font-mono text-[11px] text-muted-foreground/70"
                    title={server.url}
                  >
                    {new URL(server.url).host}
                  </P>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1"
                disabled={added || checking}
                onClick={() => void add(server)}
              >
                {checking ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : added ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {added ? t('picker.curated.added') : t('picker.add')}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
