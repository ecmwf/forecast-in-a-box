/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, GitBranch, Scissors } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DropMode } from '@/features/fable-builder/hooks/useSidebarBlockDrop'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { cn } from '@/lib/utils'

const MODE_ICON = {
  branch: GitBranch,
  insert: Scissors,
  connect: ArrowRight,
} as const

const MODE_CLASS: Record<DropMode, string> = {
  branch: 'text-emerald-600 dark:text-emerald-400',
  insert: 'text-blue-600 dark:text-blue-400',
  connect: 'text-muted-foreground',
}

/** Floating preview of the dragged palette block, portaled at the cursor.
 *  HTML5 drag suppresses `mousemove`, so `dragover` drives its position;
 *  `mode` adds a branch/insert badge when a drop target is hovered. */
export function BlockDragPreview({ mode }: { mode?: DropMode | null }) {
  const { t } = useTranslation('configure')
  const draggedFactory = useFableBuilderStore((state) => state.draggedFactory)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!draggedFactory) {
      setPoint(null)
      return
    }
    function trackCursor(e: DragEvent) {
      setPoint({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('dragover', trackCursor)
    return () => window.removeEventListener('dragover', trackCursor)
  }, [draggedFactory])

  if (!draggedFactory || !point) return null

  const { factory } = draggedFactory
  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const Icon = getBlockKindIcon(factory.kind)
  const ModeIcon = mode ? MODE_ICON[mode] : null
  const modeLabel =
    mode === 'branch'
      ? t('addNode.dropBranch')
      : mode === 'insert'
        ? t('addNode.dropInsert')
        : mode === 'connect'
          ? t('addNode.dropConnect')
          : null

  return createPortal(
    <div
      className="pointer-events-none fixed flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 shadow-xl"
      style={{ left: point.x + 14, top: point.y + 14, zIndex: 9999 }}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4 shrink-0', metadata.color)} />
        <span className="text-sm font-medium text-foreground">
          {factory.title}
        </span>
      </div>
      {mode && ModeIcon && (
        <div
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            MODE_CLASS[mode],
          )}
        >
          <ModeIcon className="h-3 w-3 shrink-0" />
          {modeLabel}
        </div>
      )}
    </div>,
    document.body,
  )
}
