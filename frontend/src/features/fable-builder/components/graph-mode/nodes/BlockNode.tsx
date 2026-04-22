/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo, useMemo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Bookmark,
  Copy,
  CopyPlus,
  MoreHorizontal,
  Settings,
  Trash2,
} from 'lucide-react'

import type { Node, NodeProps } from '@xyflow/react'
import type { FableNodeData } from '@/features/fable-builder/utils/fable-to-graph'
import { AddNodeButton } from '@/features/fable-builder/components/graph-mode/AddNodeButton'
import { useNodeDimensions } from '@/features/fable-builder/hooks/useNodeDimensions'
import {
  useBlockValidation,
  useFableBuilderStore,
} from '@/features/fable-builder/stores/fableBuilderStore'
import { H3, P } from '@/components/base/typography'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { BlockErrorOverlay } from '@/features/fable-builder/components/graph-mode/nodes/BlockErrorOverlay'
import { parseGlyphSegments } from '@/features/fable-builder/utils/glyph-display'
import { cn } from '@/lib/utils'

export type FableNode = Node<FableNodeData>

const INPUT_POSITIONS: Record<'TB' | 'LR', Position> = {
  TB: Position.Top,
  LR: Position.Left,
}

const OUTPUT_POSITIONS: Record<'TB' | 'LR', Position> = {
  TB: Position.Bottom,
  LR: Position.Right,
}

export const BlockNode = memo(function ({
  id,
  data,
  selected,
}: NodeProps<FableNode>) {
  const { factory, instance, catalogue } = data
  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const IconComponent = getBlockKindIcon(factory.kind)

  const containerRef = useNodeDimensions(id)
  const [menuOpen, setMenuOpen] = useState(false)

  const selectedBlockId = useFableBuilderStore((state) => state.selectedBlockId)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)
  const validationState = useFableBuilderStore((state) => state.validationState)
  const layoutDirection = useFableBuilderStore((state) => state.layoutDirection)
  const removeBlockCascade = useFableBuilderStore(
    (state) => state.removeBlockCascade,
  )
  const duplicateBlock = useFableBuilderStore((state) => state.duplicateBlock)
  const duplicateBlockWithChildren = useFableBuilderStore(
    (state) => state.duplicateBlockWithChildren,
  )
  const openMobileConfig = useFableBuilderStore(
    (state) => state.openMobileConfig,
  )
  const blockValidation = useBlockValidation(id)

  const inputPosition = INPUT_POSITIONS[layoutDirection]
  const outputPosition = OUTPUT_POSITIONS[layoutDirection]
  const isHorizontalLayout = layoutDirection === 'LR'

  const fable = useFableBuilderStore((state) => state.fable)

  const isSelected = selected || selectedBlockId === id
  const hasErrors = blockValidation?.hasErrors ?? false
  const errors = blockValidation?.errors ?? []
  const possibleExpansions =
    validationState?.blockStates[id]?.possibleExpansions ?? []
  const hasDownstream = useMemo(
    () =>
      Object.values(fable.blocks).some((block) =>
        Object.values(block.input_ids).includes(id),
      ),
    [fable.blocks, id],
  )

  function handleClick(): void {
    selectBlock(id)
  }

  function handleDelete(): void {
    removeBlockCascade(id)
  }

  function handleDuplicate(): void {
    duplicateBlock(id)
    setMenuOpen(false)
  }

  function handleDuplicateWithChildren(): void {
    duplicateBlockWithChildren(id)
    setMenuOpen(false)
  }

  function handleSaveAsPreset(): void {
    alert(
      'Coming soon: Saving configurations as presets will be available soon.',
    )
    setMenuOpen(false)
  }

  function handleOpenConfig(e: React.MouseEvent): void {
    e.stopPropagation()
    openMobileConfig(id)
  }

  const configSummary = Object.entries(instance.configuration_values)
    .filter(([, value]) => value)
    .slice(0, 3)

  const configValueCount = Object.keys(instance.configuration_values).length
  const remainingConfigCount = configValueCount - 3

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className={cn(
        'relative w-70 rounded-2xl border bg-card shadow-sm',
        'cursor-pointer transition-all duration-200',
        // Hover: subtle border hint (distinct from full selection)
        !isSelected &&
          !hasErrors &&
          'hover:shadow-md hover:ring-1 hover:ring-primary/20',
        // Selected: prominent blue ring + lifted scale
        isSelected &&
          'scale-[1.02] shadow-[0_0_0_2.5px_rgba(18,69,222,1),0_20px_40px_-5px_rgba(18,69,222,0.2)]',
        // Error (unselected): red ring
        hasErrors &&
          !isSelected &&
          'shadow-[0_0_0_2px_rgba(220,38,38,1),0_15px_35px_-5px_rgba(220,38,38,0.15)]',
      )}
    >
      <div
        className={cn(
          'h-1.5 w-full rounded-t-2xl opacity-80',
          metadata.topBarColor,
        )}
      />

      <div className="p-5">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <IconComponent className={cn('h-5 w-5', metadata.color)} />
            <span className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              {metadata.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Settings button - mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="nodrag h-7 w-7 text-muted-foreground hover:text-primary md:hidden"
              onClick={handleOpenConfig}
              aria-label="Configure block"
            >
              <Settings className="h-4 w-4" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="nodrag h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => e.stopPropagation()}
                  />
                }
              >
                <Trash2 className="h-4 w-4" />
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Block</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{factory.title}" and all
                    connected downstream blocks? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="nodrag h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent
                className="w-48 p-1"
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={handleDuplicate}
                >
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={handleDuplicateWithChildren}
                >
                  <CopyPlus className="h-4 w-4" />
                  Duplicate with children
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={handleSaveAsPreset}
                >
                  <Bookmark className="h-4 w-4" />
                  Save config as preset
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <H3 className="mb-1 text-lg font-semibold text-foreground">
          {factory.title}
        </H3>

        <P className="mb-4 line-clamp-2 text-muted-foreground">
          {factory.description}
        </P>

        {configSummary.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {configSummary.map(([key, value]) => {
              const stringValue = String(value)
              const truncated =
                stringValue.length > 15
                  ? `${stringValue.slice(0, 15)}...`
                  : stringValue
              const segments = parseGlyphSegments(truncated)
              const hasGlyphs = segments.some((s) => s.isGlyph)
              return (
                <span
                  key={key}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-xs font-bold',
                    metadata.bgColor,
                    metadata.borderColor,
                    metadata.color,
                  )}
                >
                  {hasGlyphs
                    ? segments.map((seg, i) =>
                        seg.isGlyph ? (
                          <span
                            key={i}
                            className="rounded bg-primary/15 px-0.5 font-mono text-primary"
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )
                    : truncated}
                </span>
              )
            })}
            {remainingConfigCount > 0 && (
              <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                +{remainingConfigCount} more
              </span>
            )}
          </div>
        )}
      </div>
      <BlockErrorOverlay errors={errors} />

      {factory.inputs.map((inputName, index) => {
        const percent = ((index + 1) / (factory.inputs.length + 1)) * 100

        return (
          <Handle
            key={inputName}
            type="target"
            position={inputPosition}
            id={inputName}
            title={inputName}
            className={cn(
              'h-5! w-5! rounded-full! border-4! bg-card!',
              isHorizontalLayout ? '-left-2.5!' : '-top-2.5!',
              inputPosition === Position.Right && '-right-2.5! left-auto!',
              inputPosition === Position.Bottom && 'top-auto! -bottom-2.5!',
              'border-foreground/30!',
              'transition-all hover:scale-110',
            )}
            style={
              isHorizontalLayout
                ? { top: `${percent}%`, transform: 'translateY(-50%)' }
                : { left: `${percent}%`, transform: 'translateX(-50%)' }
            }
          />
        )
      })}

      {factory.kind !== 'sink' && (
        <>
          <Handle
            type="source"
            position={outputPosition}
            id="output"
            title="Output"
            className={cn(
              'h-5! w-5! rounded-full! border-4! bg-card!',
              'border-foreground/30!',
              isHorizontalLayout ? '-right-2.5!' : '-bottom-2.5!',
              outputPosition === Position.Left && 'right-auto! -left-2.5!',
              outputPosition === Position.Top && '-top-2.5! bottom-auto!',
              'transition-all hover:scale-110',
            )}
            style={
              isHorizontalLayout
                ? { top: '50%', transform: 'translateY(-50%)' }
                : { left: '50%', transform: 'translateX(-50%)' }
            }
          />
          <AddNodeButton
            sourceBlockId={id}
            possibleExpansions={possibleExpansions}
            hasErrors={hasErrors}
            hasDownstream={hasDownstream}
            catalogue={catalogue}
          />
        </>
      )}
    </div>
  )
})
