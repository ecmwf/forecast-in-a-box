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
import { ArrowRight, Earth, Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { CuratedWmsList } from './sources/CuratedWmsList'
import { HostPathForm } from './sources/HostPathForm'
import { RunSourceList } from './sources/RunSourceList'
import { WmsUrlForm } from './sources/WmsUrlForm'
import { EmptyState } from '@/components/common/EmptyState'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'

export function VisualiseHub() {
  const { t } = useTranslation('visualise')
  const [search, setSearch] = useState('')

  return (
    <div className="mx-auto w-full max-w-4xl space-y-2">
      <EmptyState
        icon={Earth}
        title={t('hub.title')}
        description={t('hub.description')}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
          <P className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Rows3 className="h-3.5 w-3.5" />
            {t('hub.previousResults')}
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
            to="/runs"
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
