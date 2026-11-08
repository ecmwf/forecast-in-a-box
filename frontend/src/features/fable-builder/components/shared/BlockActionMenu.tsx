/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A block's actions, in its "..." menu and on right-click. */

import { useTranslation } from 'react-i18next'
import { Copy, CopyPlus, MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactElement } from 'react'
import type { BlockInstanceId } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface BlockAction {
  key: string
  icon: LucideIcon
  label: string
  run: () => void
}

function useBlockActions(instanceId: BlockInstanceId): Array<BlockAction> {
  const { t } = useTranslation('configure')
  const duplicateBlock = useFableBuilderStore((state) => state.duplicateBlock)
  const duplicateBlockWithChildren = useFableBuilderStore(
    (state) => state.duplicateBlockWithChildren,
  )
  return [
    {
      key: 'duplicate',
      icon: Copy,
      label: t('blockActions.duplicate'),
      run: () => duplicateBlock(instanceId),
    },
    {
      key: 'duplicateWithDownstream',
      icon: CopyPlus,
      label: t('blockActions.duplicateWithDownstream'),
      run: () => duplicateBlockWithChildren(instanceId),
    },
  ]
}

// Menus portal out, but React events still bubble to the node and select it.
const stopPropagation = (event: MouseEvent) => event.stopPropagation()

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
  stopPropagation: stop,
}: BlockActionMenuProps) {
  const { t } = useTranslation('configure')
  const actions = useBlockActions(instanceId)
  const onClick = stop ? stopPropagation : undefined

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
            onClick={onClick}
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto" onClick={onClick}>
        {actions.map(({ key, icon: Icon, label, run }) => (
          <DropdownMenuItem key={key} onClick={run}>
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Opens the block's actions on right-click of `children`. */
export function BlockContextMenu({
  instanceId,
  children,
}: {
  instanceId: BlockInstanceId
  children: ReactElement
}) {
  const actions = useBlockActions(instanceId)
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent onClick={stopPropagation}>
        {actions.map(({ key, icon: Icon, label, run }) => (
          <ContextMenuItem key={key} onClick={run}>
            <Icon />
            {label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
