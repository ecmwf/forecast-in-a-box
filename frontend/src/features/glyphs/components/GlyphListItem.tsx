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
 * GlyphListItem Component
 *
 * A single glyph row in the global glyphs list.
 */

import { Braces, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GlyphDetail } from '@/api/types/fable.types'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'

interface GlyphListItemProps {
  glyph: GlyphDetail
  onEdit: (glyph: GlyphDetail) => void
}

export function GlyphListItem({ glyph, onEdit }: GlyphListItemProps) {
  const { t } = useTranslation('glyphs')

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="mt-1 shrink-0 sm:mt-0">
          <Braces className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="grow">
          <div className="mb-1">
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm font-medium">
              {'${' + glyph.name + '}'}
            </code>
          </div>
          <P className="line-clamp-1 text-muted-foreground">
            {glyph.valueExample}
          </P>
        </div>

        <div className="mt-2 flex w-full items-center justify-end sm:mt-0 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onEdit(glyph)}
          >
            <Pencil className="h-4 w-4" />
            {t('actions.edit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
