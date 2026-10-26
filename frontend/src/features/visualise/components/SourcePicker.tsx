/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** "Manage sources" body: tabbed catalogue left, the collection right. */

import { useState } from 'react'
import { FolderInput, Globe, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryRef } from '../entry-ref'
import { useRemoveComparisonSource } from '../hooks/useRemoveComparisonSource'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
} from '../stores/comparisonStore'
import { CompareBasketChip } from './CompareBasketChip'
import { CuratedWmsList } from './sources/CuratedWmsList'
import { RunningLensList } from './sources/RunningLensList'
import { HostPathForm } from './sources/HostPathForm'
import { RunSourceList } from './sources/RunSourceList'
import { WmsUrlForm } from './sources/WmsUrlForm'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { TOUR, tourAttr } from '@/features/tutorials/anchors'

type SourceTab = 'runs' | 'wms' | 'folder'

/** Tab panel: scrolls inside the fixed-height body on sm+. */
const PANE = 'space-y-4 pt-4 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:pr-1'

export function SourcePicker() {
  const { t } = useTranslation('visualise')
  const [tab, setTab] = useState<SourceTab>('runs')
  const [search, setSearch] = useState('')

  const query = search.trim().toLowerCase()

  return (
    // min-w-0: long path strings must not widen this grid track.
    // Fixed sm+ height: panes scroll, so tab switches never re-centre it.
    <div className="grid min-w-0 gap-x-8 gap-y-5 sm:h-[min(60vh,36rem)] sm:grid-cols-2">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as SourceTab)}
        className="flex min-w-0 flex-col sm:min-h-0"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="runs">
            <Rows3 className="h-4 w-4" />
            {t('picker.tabs.runs')}
          </TabsTrigger>
          {/* Anchored so the map tour can hop to this tab before pressing Add. */}
          <TabsTrigger value="wms" {...tourAttr(TOUR.visualise.sourceTabWms)}>
            <Globe className="h-4 w-4" />
            {t('picker.tabs.wms')}
          </TabsTrigger>
          <TabsTrigger value="folder">
            <FolderInput className="h-4 w-4" />
            {t('picker.tabs.folder')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className={PANE}>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="h-9"
          />
          <RunningLensList query={query} />
          <RunSourceList query={query} />
        </TabsContent>
        <TabsContent value="wms" className={cn(PANE, 'space-y-5')}>
          <WmsUrlForm />
          <CuratedWmsList />
        </TabsContent>
        <TabsContent value="folder" className={PANE}>
          <HostPathForm />
        </TabsContent>
      </Tabs>

      <CollectedSources />
    </div>
  )
}

/** What is in the basket (rename path/wms, remove), with an empty hint. */
function CollectedSources() {
  const { t } = useTranslation('visualise')
  const entries = useComparisonStore((s) => s.entries)
  const removeSource = useRemoveComparisonSource()
  return (
    <section className="flex min-w-0 flex-col gap-1.5 sm:min-h-0">
      <P className="flex shrink-0 items-baseline justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span>{t('picker.collected')}</span>
        <span className="font-mono normal-case">
          {t('picker.collectedCount', {
            count: entries.length,
            max: MAX_COMPARISON_ENTRIES,
          })}
        </span>
      </P>
      {entries.length === 0 ? (
        <P className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('picker.collectedEmpty')}
        </P>
      ) : (
        <div className="flex flex-col gap-1.5 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:pr-1">
          {entries.map((entry) => (
            <CompareBasketChip
              key={entryRef(entry)}
              entry={entry}
              slot={null}
              onRemove={() => removeSource(entry)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
