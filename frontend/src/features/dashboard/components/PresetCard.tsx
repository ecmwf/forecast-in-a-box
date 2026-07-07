/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A saved configuration preset — a card carrying Forecast Journal row content. */

import { useState } from 'react'
import { Pencil, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { PresetEntry } from '@/features/dashboard/hooks/useConfigPresets'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { CoreVersionMismatchBadge } from '@/components/common/CoreVersionMismatchBadge'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import { JournalChip } from '@/features/journal/components/JournalChip'
import { RunMetadataDialog } from '@/features/journal/components/RunMetadataDialog'
import { cn } from '@/lib/utils'

export function PresetCard({
  preset,
  onToggleFavourite,
}: {
  preset: PresetEntry
  onToggleFavourite: () => void
}) {
  const { t } = useTranslation(['journal', 'dashboard'])
  const { data: blueprint } = useFableRetrieve(preset.blueprintId)
  // Forked-from lineage (e.g. the template this preset was created from)
  const { data: parent } = useFableRetrieve(blueprint?.parent_id ?? null)
  const [metadataOpen, setMetadataOpen] = useState(false)

  const builder = blueprint?.builder
  const { modelLabel, outputKinds, outputCount } = preset

  const title = preset.displayName || t('item.untitled')

  return (
    <div className="group/card flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
      <div className="flex items-start gap-1.5">
        <Link
          to="/configure"
          search={{ fableId: preset.blueprintId }}
          className="min-w-0 grow truncate text-sm font-medium hover:underline"
        >
          {title}
        </Link>
        <button
          type="button"
          onClick={() => setMetadataOpen(true)}
          aria-label={t('item.editMetadata')}
          className="shrink-0 text-muted-foreground opacity-0 transition-[color,opacity] group-focus-within/card:opacity-100 group-hover/card:opacity-100 hover:text-primary [@media(hover:none)]:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleFavourite}
          aria-label={t('item.bookmark')}
          className={cn(
            'shrink-0 text-muted-foreground transition-colors hover:text-yellow-500',
            preset.isFavourite && 'text-yellow-500',
          )}
        >
          <Star
            className={cn('h-4 w-4', preset.isFavourite && 'fill-yellow-500')}
          />
        </button>
      </div>

      {preset.displayDescription && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {preset.displayDescription}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        {t('item.outputs', { count: outputCount })}
        {parent?.display_name &&
          ` · ${t('dashboard:presets.basedOn', { name: parent.display_name })}`}
      </p>

      {preset.coreVersionMismatch && (
        <CoreVersionMismatchBadge
          detail={preset.coreVersionMismatch}
          className="self-start"
        />
      )}

      {(modelLabel || outputKinds.length > 0 || preset.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {modelLabel && <JournalChip label={modelLabel} variant="facet" />}
          {outputKinds.map((kind) => (
            <JournalChip key={kind} label={kind} variant="facet" />
          ))}
          {preset.tags.map((tag) => (
            <JournalChip key={tag} label={tag} variant="tag" />
          ))}
        </div>
      )}

      {builder && (
        <div className="pt-1">
          <FableMiniFlow builder={builder} monochrome={false} />
        </div>
      )}

      <RunMetadataDialog
        blueprint={blueprint}
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
      />
    </div>
  )
}
