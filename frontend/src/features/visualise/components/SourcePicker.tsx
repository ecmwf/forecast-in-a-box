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
 * Source picker for the basket — the "Add source" dialog body. Sections:
 *  1. recent runs with stored (GRIB-dir) outputs (RunSourceList)
 *  2. running lens servers, matched back to outputs by path
 *  3. external data: host GRIB directory + external WMS endpoint
 */

import { useState } from 'react'
import { FolderInput, Radar, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryRef } from '../entry-ref'
import { useLensPathIndex } from '../hooks/useLensPathIndex'
import { useComparisonStore } from '../stores/comparisonStore'
import { AddToComparisonButton } from './AddToComparisonButton'
import { CompareBasketChip } from './CompareBasketChip'
import { HostPathForm } from './sources/HostPathForm'
import { RunSourceList } from './sources/RunSourceList'
import { WmsUrlForm } from './sources/WmsUrlForm'
import { useLensList } from '@/api/hooks/useLens'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'

export function SourcePicker() {
  const { t } = useTranslation('visualise')
  const [search, setSearch] = useState('')
  const { data: lenses } = useLensList()
  const pathIndex = useLensPathIndex()

  const query = search.trim().toLowerCase()

  return (
    // min-w-0: as a dialog-grid item the picker must not let unbreakable
    // path strings dictate its track width (grid items min-width:auto).
    // Two columns: find-and-add on the left; the collection (a live
    // dedupe reference while adding) + external entry on the right.
    <div className="grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
      <div className="min-w-0 space-y-5">
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
          <RunSourceList query={query} />
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
      </div>

      <div className="min-w-0 space-y-5">
        <CollectedSources />

        {/* External data — host path + external WMS endpoint */}
        <section className="space-y-3">
          <SectionLabel icon={<FolderInput className="h-3.5 w-3.5" />}>
            {t('picker.external')}
          </SectionLabel>
          <HostPathForm />
          <WmsUrlForm />
        </section>
      </div>
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

/** Manage what's already in the basket (rename path/wms, remove). */
function CollectedSources() {
  const { t } = useTranslation('visualise')
  const entries = useComparisonStore((s) => s.entries)
  const removeEntry = useComparisonStore((s) => s.removeEntry)
  if (entries.length === 0) return null
  return (
    <section className="space-y-1.5">
      <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('picker.collected')}
      </P>
      <div className="flex flex-col gap-1.5">
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
