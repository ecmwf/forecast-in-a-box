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
 * GlyphsPage Component
 *
 * Admin page for listing and managing global glyph definitions.
 */

import { useState } from 'react'
import { Braces, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GlobalGlyphItem } from '@/api/types/fable.types'
import { useListGlobalGlyphs } from '@/api/hooks/useFable'
import { GlyphFormDialog } from '@/features/glyphs/components/GlyphFormDialog'
import { GlyphListItem } from '@/features/glyphs/components/GlyphListItem'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { H2 } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useUiStore } from '@/stores/uiStore'

const PAGE_SIZE = 10

export function GlyphsPage() {
  const { t } = useTranslation('glyphs')
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editGlyph, setEditGlyph] = useState<GlobalGlyphItem | undefined>()

  const { data, isLoading, isError, error } = useListGlobalGlyphs(
    page,
    PAGE_SIZE,
  )

  function handleCreate() {
    setEditGlyph(undefined)
    setDialogOpen(true)
  }

  function handleEdit(glyph: GlobalGlyphItem) {
    setEditGlyph(glyph)
    setDialogOpen(true)
  }

  if (isLoading) {
    return (
      <ListPageContainer>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <div className="flex justify-center py-12">
          <LoadingSpinner text={t('list.loading')} />
        </div>
      </ListPageContainer>
    )
  }

  if (isError) {
    return (
      <ListPageContainer>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <ErrorPanel message={error.message} />
      </ListPageContainer>
    )
  }

  const glyphs = (data?.glyphs ?? []).filter(
    (g): g is GlobalGlyphItem => g.glyph_type === 'global',
  )
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  let filteredGlyphs = glyphs
  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    filteredGlyphs = glyphs.filter(
      (g) =>
        g.key.toLowerCase().includes(query) ||
        g.value.toLowerCase().includes(query),
    )
  }

  return (
    <ListPageContainer>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={
          <Button onClick={handleCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t('actions.create')}
          </Button>
        }
      />

      <Card
        className="overflow-hidden"
        variant={dashboardVariant}
        shadow={panelShadow}
      >
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
          <H2 className="text-xl font-semibold">{t('page.title')}</H2>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <Input
                type="text"
                placeholder={t('filter.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 sm:w-64"
              />
            </div>
          </div>
        </div>

        <div className="divide-y divide-border">
          {filteredGlyphs.length > 0 ? (
            filteredGlyphs.map((glyph) => (
              <GlyphListItem
                key={`${glyph.created_by}:${glyph.key}`}
                glyph={glyph}
                onEdit={handleEdit}
              />
            ))
          ) : (
            <EmptyState
              icon={Braces}
              title={t('empty.title')}
              description={t('empty.description')}
            />
          )}
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </Card>

      <GlyphFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editGlyph={editGlyph}
      />
    </ListPageContainer>
  )
}
