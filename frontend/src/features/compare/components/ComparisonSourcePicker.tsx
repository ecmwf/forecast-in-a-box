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
 * Source picker for the comparison basket — the /compare empty state and
 * the "Add source" dialog body. Three sections:
 *  1. recent runs with stored (GRIB-dir) outputs — scans page 1 of the
 *     run list only (documented limitation until the backend can filter)
 *  2. running lens servers, matched back to outputs by path
 *  3. external data: a GRIB directory on the FIAB host (a lens is started
 *     on it when the source becomes active). External WMS URLs follow in
 *     a later phase.
 */

import { useMemo, useState } from 'react'
import { FolderInput, Globe, Loader2, Radar, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName } from '../entry-ref'
import { gribMarkerRows, useLensPathIndex } from '../hooks/useLensPathIndex'
import { probeWmsEndpoint } from '../wms-probe'
import { useComparisonStore } from '../stores/comparisonStore'
import { AddToComparisonButton } from './AddToComparisonButton'
import { CompareBasketChip } from './CompareBasketChip'
import { entryRef } from '../entry-ref'
import type { GribMarkerRow } from '../hooks/useLensPathIndex'
import type { NewComparisonEntry } from '../entry-ref'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { useLensList } from '@/api/hooks/useLens'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'
import { formatInZone, useAppTimeZone } from '@/lib/datetime'

const PICKER_RUNS = 20

export function ComparisonSourcePicker() {
  const { t } = useTranslation('compare')
  const [search, setSearch] = useState('')
  const { data: jobsList } = useJobsStatus(1, PICKER_RUNS)
  const { data: lenses } = useLensList()
  const pathIndex = useLensPathIndex()

  const markerRows = useMemo(
    () => gribMarkerRows(jobsList?.runs ?? []),
    [jobsList],
  )

  const query = search.trim().toLowerCase()

  return (
    // min-w-0: as a dialog-grid item the picker must not let unbreakable
    // path strings dictate its track width (grid items min-width:auto).
    <div className="min-w-0 space-y-5">
      <CollectedSources />
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('picker.searchPlaceholder')}
        className="h-9"
      />

      {/* Recent runs */}
      <section className="space-y-1">
        <SectionLabel icon={<Rows3 className="h-3.5 w-3.5" />}>
          {t('picker.recentRuns')}
        </SectionLabel>
        {markerRows.length === 0 ? (
          <P className="py-2 text-sm text-muted-foreground">
            {t('picker.empty')}
          </P>
        ) : (
          <ul className="divide-y divide-border">
            {markerRows.map((row) => (
              <RunSourceRow
                key={`${row.jobId}:${row.blockId}`}
                row={row}
                filter={query}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Running lenses */}
      {lenses && lenses.length > 0 && (
        <section className="space-y-1">
          <SectionLabel icon={<Radar className="h-3.5 w-3.5" />}>
            {t('picker.runningLenses')}
          </SectionLabel>
          <ul className="divide-y divide-border">
            {lenses.map((lens) => {
              const path =
                typeof lens.lens_params.local_path === 'string'
                  ? lens.lens_params.local_path
                  : ''
              const match = path ? pathIndex.get(path) : undefined
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
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* External data — host path + external WMS endpoint */}
      <section className="space-y-2">
        <SectionLabel icon={<FolderInput className="h-3.5 w-3.5" />}>
          {t('picker.external')}
        </SectionLabel>
        <HostPathForm />
        <WmsUrlForm />
      </section>
    </div>
  )
}

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <P className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {icon}
      {children}
    </P>
  )
}

/** One run-output row: blueprint name resolved lazily per row. */
function RunSourceRow({ row, filter }: { row: GribMarkerRow; filter: string }) {
  const timeZone = useAppTimeZone()
  const { data: fableData } = useFableRetrieve(useRunBlueprintId(row.jobId))
  const runName = fableData?.display_name?.trim() ?? ''

  const entry: NewComparisonEntry = {
    kind: 'output',
    jobId: row.jobId,
    taskId: row.taskId,
    blockId: row.blockId,
    runName,
    blockTitle: row.blockId,
    runCreatedAt: row.runCreatedAt,
  }
  const name = entryDisplayName(entry)
  const haystack = `${name} ${row.blockId} ${row.jobId}`.toLowerCase()
  if (filter && !haystack.includes(filter)) return null

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <P className="truncate text-sm font-medium">{name}</P>
        <P className="truncate font-mono text-xs text-muted-foreground">
          {row.blockId}
          {row.runCreatedAt
            ? ` · ${formatInZone(new Date(row.runCreatedAt), timeZone, 'yyyy-MM-dd HH:mm')}`
            : ''}
        </P>
      </div>
      <AddToComparisonButton entry={entry} />
    </li>
  )
}

/** blueprint_id for a run, from the cached run list / status queries. */
function useRunBlueprintId(jobId: string): string | undefined {
  const { data: jobsList } = useJobsStatus(1, PICKER_RUNS)
  return jobsList?.runs.find((r) => r.run_id === jobId)?.blueprint_id
}

function HostPathForm() {
  const { t } = useTranslation('compare')
  const [path, setPath] = useState('')
  const addEntry = useComparisonStore((s) => s.addEntry)

  const submit = () => {
    const trimmed = path.trim()
    if (!trimmed) return
    const label = trimmed.replace(/\/$/, '').split('/').pop() || trimmed
    const result = addEntry({ kind: 'path', path: trimmed, label })
    if (result === 'added') {
      showToast.success(t('toast.added', { name: label }))
      setPath('')
    } else if (result === 'full') {
      showToast.error(t('toast.full', { max: 8 }))
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <P className="text-sm font-medium">{t('picker.hostPath.title')}</P>
      <P className="text-xs text-muted-foreground">
        {t('picker.hostPath.description')}
      </P>
      <div className="flex gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={t('picker.hostPath.placeholder')}
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={submit}
          disabled={!path.trim()}
          className="h-8 shrink-0"
        >
          {t('picker.add')}
        </Button>
      </div>
    </div>
  )
}

type WmsFormError =
  | { reason: 'invalid-url' | 'unreachable' | 'parse' }
  | { reason: 'http'; status: number }
  | null

function WmsUrlForm() {
  const { t } = useTranslation('compare')
  const [url, setUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<WmsFormError>(null)
  const addEntry = useComparisonStore((s) => s.addEntry)

  const submit = async () => {
    if (probing || !url.trim()) return
    setProbing(true)
    setError(null)
    const result = await probeWmsEndpoint(url)
    setProbing(false)
    if (!result.ok) {
      setError(
        result.reason === 'http'
          ? { reason: 'http', status: result.status }
          : { reason: result.reason },
      )
      return
    }
    const added = addEntry({
      kind: 'wms',
      url: result.baseUrl,
      label: result.label,
    })
    if (added === 'added') {
      showToast.success(t('toast.added', { name: result.label }))
      setUrl('')
    } else if (added === 'full') {
      showToast.error(t('toast.full', { max: 8 }))
    }
  }

  const errorText =
    error === null
      ? null
      : error.reason === 'invalid-url'
        ? t('picker.wmsUrl.errorInvalidUrl')
        : error.reason === 'unreachable'
          ? t('picker.wmsUrl.errorUnreachable')
          : error.reason === 'http'
            ? t('picker.wmsUrl.errorHttp', { status: error.status })
            : t('picker.wmsUrl.errorParse')

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <P className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        {t('picker.wmsUrl.title')}
      </P>
      <P className="text-xs text-muted-foreground">
        {t('picker.wmsUrl.description')}
      </P>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder={t('picker.wmsUrl.placeholder')}
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void submit()}
          disabled={!url.trim() || probing}
          className="h-8 shrink-0 gap-1.5"
        >
          {probing && <Loader2 className="h-3 w-3 animate-spin" />}
          {probing ? t('picker.wmsUrl.probing') : t('picker.wmsUrl.connect')}
        </Button>
      </div>
      {errorText && <P className="text-xs text-destructive">{errorText}</P>}
    </div>
  )
}

/** Manage what's already in the basket (rename path/wms, remove). */
function CollectedSources() {
  const { t } = useTranslation('compare')
  const entries = useComparisonStore((s) => s.entries)
  const removeEntry = useComparisonStore((s) => s.removeEntry)
  if (entries.length === 0) return null
  return (
    <section className="space-y-1.5">
      <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('picker.collected')}
      </P>
      <div className="flex flex-wrap items-center gap-2">
        {entries.map((entry) => {
          const ref = entryRef(entry)
          return (
            <CompareBasketChip
              key={ref}
              entry={entry}
              slot={null}
              onRemove={() => removeEntry(ref)}
            />
          )
        })}
      </div>
    </section>
  )
}
