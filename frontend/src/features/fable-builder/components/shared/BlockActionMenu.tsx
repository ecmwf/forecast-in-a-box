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

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, CopyPlus, MoreHorizontal, Replace } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactElement } from 'react'
import type {
  BlockFactoryCatalogue,
  BlockInstance,
  BlockInstanceId,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { ReplacementCandidate } from '@/features/fable-builder/utils/replace-block'
import {
  factoryIdToKey,
  getFactory,
  pluginIdToDisplayKey,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  collidingTitles,
  qualifiedFactoryTitle,
} from '@/features/fable-builder/utils/block-names'
import {
  replaceBlockInstance,
  replacementCandidates,
  sameBlockInstance,
} from '@/features/fable-builder/utils/replace-block'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { showToast } from '@/lib/toast'
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

interface Replacements {
  /** `null` while the workflow is being checked. */
  candidates: Array<ReplacementCandidate> | null
  replace: (candidate: ReplacementCandidate) => void
}

function useReplacements(
  instanceId: BlockInstanceId,
  catalogue: BlockFactoryCatalogue,
): Replacements {
  const { t } = useTranslation('configure')
  const fable = useFableBuilderStore((state) => state.fable)
  const validation = useFableBuilderStore((state) => state.validationState)
  const replaceBlock = useFableBuilderStore((state) => state.replaceBlock)
  const candidates = useMemo(
    () =>
      validation
        ? replacementCandidates(instanceId, fable, catalogue, validation)
        : null,
    [instanceId, fable, catalogue, validation],
  )

  const replace = ({ factoryId, factory, label }: ReplacementCandidate) => {
    const block = fable.blocks[instanceId]
    const from = getFactory(catalogue, block.factory_id)
    if (!from) return
    const { instance, kept, dropped } = replaceBlockInstance(
      block,
      from,
      factoryId,
      factory,
    )
    replaceBlock(instanceId, instance)
    const swapped = useFableBuilderStore.getState().fable
    const fromLabel = qualifiedFactoryTitle(
      from.title,
      pluginIdToDisplayKey(block.factory_id.plugin),
      collidingTitles(catalogue),
    )
    showToast.successWithAction(
      t('blockActions.replaced', { from: fromLabel, to: label }),
      kept.length + dropped.length > 0
        ? t('blockActions.keptOptions', {
            kept: kept.length,
            count: kept.length + dropped.length,
          })
        : undefined,
      {
        label: t('header.undo'),
        onClick: () => {
          if (!undoReplace(instanceId, block, instance, swapped)) {
            showToast.info(
              t('blockActions.undoStale'),
              t('blockActions.undoStaleHint'),
            )
          }
        },
      },
    )
  }

  return { candidates, replace }
}

/** Reverts a replace: a plain undo while nothing changed since, else the old block while the new one is untouched; false if neither. */
function undoReplace(
  instanceId: BlockInstanceId,
  original: BlockInstance,
  replacement: BlockInstance,
  swapped: FableBuilderV1,
): boolean {
  const state = useFableBuilderStore.getState()
  if (state.fable === swapped) {
    state.undo()
    return true
  }
  const { blocks } = state.fable
  const current = blocks[instanceId] as BlockInstance | undefined
  // The replacement is untouched and the old inputs still exist.
  const restorable =
    current !== undefined &&
    sameBlockInstance(current, replacement) &&
    Object.values(original.input_ids).every(
      (parent) => parent === '' || Object.hasOwn(blocks, parent),
    )
  if (restorable) state.replaceBlock(instanceId, original)
  return restorable
}

/** The candidates, or one disabled line saying why there are none. */
function replaceItems(
  { candidates, replace }: Replacements,
  empty: string,
  Item: typeof DropdownMenuItem | typeof ContextMenuItem,
) {
  if (!candidates || candidates.length === 0) {
    return <Item disabled>{empty}</Item>
  }
  return candidates.map((candidate) => (
    <Item
      key={factoryIdToKey(candidate.factoryId)}
      onClick={() => replace(candidate)}
    >
      {candidate.label}
    </Item>
  ))
}

// Menus portal out, but React events still bubble to the node and select it.
const stopPropagation = (event: MouseEvent) => event.stopPropagation()

interface BlockActionMenuProps {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
  /** Trigger button classes — sizing differs between graph node and form card. */
  triggerClassName?: string
  /** Graph nodes stop click propagation so the canvas doesn't deselect. */
  stopPropagation?: boolean
}

export function BlockActionMenu({
  instanceId,
  catalogue,
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
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Replace />
            {t('blockActions.replaceWith')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto">
            <ReplaceDropdownItems
              instanceId={instanceId}
              catalogue={catalogue}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The candidates load only while the submenu is open.
function ReplaceDropdownItems(props: {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
}) {
  const { t } = useTranslation('configure')
  const replacements = useReplacements(props.instanceId, props.catalogue)
  const empty = replacements.candidates
    ? t('blockActions.noReplacement')
    : t('blockActions.checking')
  return replaceItems(replacements, empty, DropdownMenuItem)
}

function ReplaceContextItems(props: {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
}) {
  const { t } = useTranslation('configure')
  const replacements = useReplacements(props.instanceId, props.catalogue)
  const empty = replacements.candidates
    ? t('blockActions.noReplacement')
    : t('blockActions.checking')
  return replaceItems(replacements, empty, ContextMenuItem)
}

/** Opens the block's actions on right-click of `children`. */
export function BlockContextMenu({
  instanceId,
  catalogue,
  children,
}: {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
  children: ReactElement
}) {
  const { t } = useTranslation('configure')
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
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Replace />
            {t('blockActions.replaceWith')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ReplaceContextItems
              instanceId={instanceId}
              catalogue={catalogue}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
