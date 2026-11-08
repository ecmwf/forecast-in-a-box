/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Block "more actions" menu for the graph node. */

import { useTranslation } from 'react-i18next'
import { Copy, CopyPlus, MoreHorizontal } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { BlockInstanceId } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface BlockActionMenuProps {
  instanceId: BlockInstanceId
  /** Trigger button classes — sizing differs between graph node and form card. */
  triggerClassName?: string
  /** Graph nodes stop click propagation so the canvas doesn't deselect. */
  stopPropagation?: boolean
}

export function BlockActionMenu({
  instanceId,
  triggerClassName,
  stopPropagation,
}: BlockActionMenuProps) {
  const { t } = useTranslation('configure')
  const duplicateBlock = useFableBuilderStore((state) => state.duplicateBlock)
  const duplicateBlockWithChildren = useFableBuilderStore(
    (state) => state.duplicateBlockWithChildren,
  )

  const stop = stopPropagation
    ? (event: MouseEvent) => event.stopPropagation()
    : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('blockActions.more')}
            className={cn(
              'text-muted-foreground hover:text-foreground',
              triggerClassName,
            )}
            onClick={stop}
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto" onClick={stop}>
        <DropdownMenuItem onClick={() => duplicateBlock(instanceId)}>
          <Copy />
          {t('blockActions.duplicate')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => duplicateBlockWithChildren(instanceId)}
        >
          <CopyPlus />
          {t('blockActions.duplicateWithChildren')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
