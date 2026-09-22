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
 * Empty-state hub of the Visualise page: what the page does and the three
 * ways in — a previously generated result, an external WMS endpoint, or a
 * GRIB folder on the FIAB host. Adding any source flips the page into the
 * viewer (single first, comparison once a second is added).
 */

import { useState } from 'react'
import { ArrowRight, Earth, GraduationCap, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { CuratedWmsList } from './sources/CuratedWmsList'
import { HostPathForm } from './sources/HostPathForm'
import { RunSourceList } from './sources/RunSourceList'
import { RunningLensList } from './sources/RunningLensList'
import { WmsUrlForm } from './sources/WmsUrlForm'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { TOUR, tourAttr } from '@/features/tutorials/anchors'
import { useTutorialsStore } from '@/stores/tutorialsStore'

export function VisualiseHub() {
  const { t } = useTranslation(['visualise', 'tutorials'])
  const [search, setSearch] = useState('')

  return (
    <div className="mx-auto w-full max-w-4xl space-y-2">
      <div {...tourAttr(TOUR.visualise.hub)}>
        <EmptyState
          icon={Earth}
          title={t('hub.title')}
          description={t('hub.description')}
        />
        {/* Tour entry point where new users look first; the Help dialog
            offers the same tour. */}
        <div className="flex justify-center pb-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() =>
              useTutorialsStore.getState().start('visualise-first-map')
            }
          >
            <GraduationCap className="h-3.5 w-3.5" />
            {t('tutorials:launch.hubCta', {
              name: t('tutorials:firstMap.title'),
            })}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
          <RunningLensList />
          <P className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Rows3 className="h-3.5 w-3.5" />
            {t('picker.recentRuns')}
          </P>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="h-8"
          />
          <RunSourceList query={search.trim().toLowerCase()} paged />
          <Link
            to="/execute"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('hub.browseAll')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
        <section className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-4">
          <WmsUrlForm />
          <CuratedWmsList />
          <HostPathForm />
        </section>
      </div>
    </div>
  )
}
