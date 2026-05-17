/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Block "more actions" menu — shared by the graph node and the form-mode card. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, Copy, CopyPlus, MoreHorizontal } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { BlockInstanceId } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface BlockActionMenuProps {
  instanceId: BlockInstanceId
  /** Trigger button classes — sizing differs between graph node and form card. */
  triggerClassName?: string
  /** Graph nodes stop click propagation so the canvas doesn't deselect. */
  stopPropagation?: boolean
}

const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent'

export function BlockActionMenu({
  instanceId,
  triggerClassName,
  stopPropagation,
}: BlockActionMenuProps) {
  const { t } = useTranslation('configure')
  const [open, setOpen] = useState(false)
  const duplicateBlock = useFableBuilderStore((state) => state.duplicateBlock)
  const duplicateBlockWithChildren = useFableBuilderStore(
    (state) => state.duplicateBlockWithChildren,
  )

  function run(action: () => void) {
    action()
    setOpen(false)
  }

  const stop = stopPropagation
    ? (event: MouseEvent) => event.stopPropagation()
    : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'text-muted-foreground hover:text-foreground',
              triggerClassName,
            )}
            onClick={stop}
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end" onClick={stop}>
        <button
          className={ITEM_CLASS}
          onClick={() => run(() => duplicateBlock(instanceId))}
        >
          <Copy className="h-4 w-4" />
          {t('blockActions.duplicate')}
        </button>
        <button
          className={ITEM_CLASS}
          onClick={() => run(() => duplicateBlockWithChildren(instanceId))}
        >
          <CopyPlus className="h-4 w-4" />
          {t('blockActions.duplicateWithChildren')}
        </button>
        <button
          className={ITEM_CLASS}
          onClick={() => run(() => alert(t('blockActions.comingSoonPreset')))}
        >
          <Bookmark className="h-4 w-4" />
          {t('blockActions.saveAsPreset')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
