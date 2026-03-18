/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import { ArrowRight, Check, Plus } from 'lucide-react'
import { BlockInstanceCard } from './BlockInstanceCard'
import { BlockTabs } from './BlockTabs'
import { FormPaletteSidebar } from './FormPaletteSidebar'
import { PipelineDiagram } from './PipelineDiagram'
import { PipelineSidebar } from './PipelineSidebar'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  factoryIdToKey,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface FableFormCanvasProps {
  catalogue: BlockFactoryCatalogue
}

type FormStep = 'source' | 'transform' | 'product' | 'sink'

const STEP_ORDER: Array<FormStep> = ['source', 'transform', 'product', 'sink']

export function FableFormCanvas({ catalogue }: FableFormCanvasProps) {
  const [currentStep, setCurrentStep] = useState<FormStep>('source')

  const fable = useFableBuilderStore((state) => state.fable)
  const validationState = useFableBuilderStore((state) => state.validationState)
  const addBlock = useFableBuilderStore((state) => state.addBlock)
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const selectedBlockId = useFableBuilderStore((state) => state.selectedBlockId)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)

  // Handle block click from pipeline diagram
  const handleBlockClick = (blockId: BlockInstanceId, step: BlockKind) => {
    setCurrentStep(step)
    selectBlock(blockId)
  }

  const blocksByKind = useMemo(() => {
    const groups: Record<
      BlockKind,
      Array<{ id: string; factoryId: PluginBlockFactoryId }>
    > = {
      source: [],
      transform: [],
      product: [],
      sink: [],
    }

    for (const [id, instance] of Object.entries(fable.blocks)) {
      const factory = getFactory(catalogue, instance.factory_id)
      if (factory) {
        groups[factory.kind].push({ id, factoryId: instance.factory_id })
      }
    }

    return groups
  }, [fable.blocks, catalogue])

  const availableFactories = useMemo(() => {
    if (!validationState) return []

    const blockCount = Object.keys(fable.blocks).length

    // Collect all possible expansions from existing blocks
    const allExpansions = new Map<string, PluginBlockFactoryId>()
    for (const blockState of Object.values(validationState.blockStates)) {
      for (const expansion of blockState.possibleExpansions) {
        allExpansions.set(factoryIdToKey(expansion), expansion)
      }
    }

    // For source step, also include possibleSources (allows adding multiple sources)
    if (currentStep === 'source') {
      for (const sourceId of validationState.possibleSources) {
        allExpansions.set(factoryIdToKey(sourceId), sourceId)
      }
    }

    // If no blocks yet, show initial sources
    if (blockCount === 0 && currentStep === 'source') {
      return validationState.possibleSources
        .map((factoryId) => ({
          factoryId,
          factory: getFactory(catalogue, factoryId),
        }))
        .filter(
          (
            item,
          ): item is {
            factoryId: PluginBlockFactoryId
            factory: NonNullable<ReturnType<typeof getFactory>>
          } => item.factory !== undefined,
        )
    }

    return Array.from(allExpansions.values())
      .map((factoryId) => ({
        factoryId,
        factory: getFactory(catalogue, factoryId),
      }))
      .filter(
        (
          item,
        ): item is {
          factoryId: PluginBlockFactoryId
          factory: NonNullable<ReturnType<typeof getFactory>>
        } => item.factory !== undefined && item.factory.kind === currentStep,
      )
  }, [validationState, fable.blocks, catalogue, currentStep])

  const currentBlocks = blocksByKind[currentStep]
  // Transform step is optional - can advance even without adding transform blocks
  const isOptionalStep = currentStep === 'transform'
  const canAdvance =
    STEP_ORDER.indexOf(currentStep) < STEP_ORDER.length - 1 &&
    (currentBlocks.length > 0 || isOptionalStep)

  function stepHasBlocks(step: FormStep): boolean {
    return blocksByKind[step].length > 0
  }

  const handleNextStep = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep)
    if (currentIndex < STEP_ORDER.length - 1) {
      setCurrentStep(STEP_ORDER[currentIndex + 1])
    }
  }

  const handlePrevStep = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep)
    if (currentIndex > 0) {
      setCurrentStep(STEP_ORDER[currentIndex - 1])
    }
  }

  const handleAddBlock = (factoryId: PluginBlockFactoryId) => {
    const factory = getFactory(catalogue, factoryId)
    if (factory) {
      addBlock(factoryId, factory)
    }
  }

  // Add a new block and connect it to a source block
  const handleAddConnectedBlock = (
    factoryId: PluginBlockFactoryId,
    sourceBlockId: BlockInstanceId,
  ) => {
    const factory = getFactory(catalogue, factoryId)
    if (factory) {
      const newBlockId = addBlock(factoryId, factory)
      // Connect the first input of the new block to the source
      if (factory.inputs.length > 0) {
        connectBlocks(newBlockId, factory.inputs[0], sourceBlockId)
      }
      // Navigate to the new block's step
      setCurrentStep(factory.kind)
    }
  }

  // Handle clicking on a block from within a card (downstream connection click)
  const handleCardBlockClick = (blockId: BlockInstanceId) => {
    const block = fable.blocks[blockId] as
      | (typeof fable.blocks)[string]
      | undefined
    if (!block) return
    const blockFactory = getFactory(catalogue, block.factory_id)
    if (blockFactory) {
      setCurrentStep(blockFactory.kind)
      selectBlock(blockId)
    }
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 bg-muted/30">
      {/* Left sidebar - Block Palette */}
      <FormPaletteSidebar catalogue={catalogue} />

      {/* Main content area */}
      <div className="h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto max-w-3xl min-w-0 space-y-6 px-4 py-6">
          {/* Step Navigation - Responsive: icons only on mobile, full labels on sm+ */}
          <div className="flex items-center justify-center gap-1 rounded-lg border bg-card p-2 sm:justify-between sm:gap-0 sm:p-4">
            {STEP_ORDER.map((step, index) => {
              const metadata = BLOCK_KIND_METADATA[step]
              const IconComponent = getBlockKindIcon(step)
              const isActive = step === currentStep
              const isCompleted =
                stepHasBlocks(step) &&
                STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(currentStep)
              const hasBlocks = stepHasBlocks(step)

              return (
                <div key={step} className="flex items-center">
                  <button
                    onClick={() => setCurrentStep(step)}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors sm:gap-2 sm:px-3 sm:py-2',
                      isActive && 'bg-primary text-primary-foreground',
                      !isActive && hasBlocks && 'bg-muted',
                      !isActive && !hasBlocks && 'text-muted-foreground',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full sm:h-6 sm:w-6',
                        isActive && 'bg-primary-foreground text-primary',
                        !isActive && isCompleted && 'bg-green-500 text-white',
                        !isActive && !isCompleted && 'bg-muted-foreground/20',
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-3 w-3 sm:h-4 sm:w-4" />
                      ) : (
                        <IconComponent className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      )}
                    </div>
                    <span className="hidden text-sm font-medium sm:inline">
                      {metadata.label}
                    </span>
                    {hasBlocks && (
                      <Badge
                        variant="secondary"
                        className="ml-0.5 px-1.5 py-0 text-sm sm:ml-1"
                      >
                        {blocksByKind[step].length}
                      </Badge>
                    )}
                  </button>
                  {index < STEP_ORDER.length - 1 && (
                    <ArrowRight className="mx-1 h-3 w-3 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4" />
                  )}
                </div>
              )
            })}
          </div>

          {/* Navigation Buttons - Stack on mobile, row on sm+ */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              onClick={handlePrevStep}
              disabled={STEP_ORDER.indexOf(currentStep) === 0}
              className="w-full sm:w-auto"
            >
              Previous Step
            </Button>
            <Button
              onClick={handleNextStep}
              disabled={!canAdvance}
              className="w-full sm:w-auto"
            >
              Next Step
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    const IconComponent = getBlockKindIcon(currentStep)
                    const metadata = BLOCK_KIND_METADATA[currentStep]
                    return (
                      <>
                        <div className={cn('rounded-md p-2', metadata.bgColor)}>
                          <IconComponent
                            className={cn('h-5 w-5', metadata.color)}
                          />
                        </div>
                        <div>
                          <CardTitle>{metadata.label}s</CardTitle>
                          <CardDescription>
                            {metadata.description}
                          </CardDescription>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {blocksByKind[currentStep].length > 0 && (
                <div className="space-y-3">
                  {/* Tabbed view when multiple blocks, single card when only one */}
                  {blocksByKind[currentStep].length > 1 ? (
                    <BlockTabs
                      blocks={blocksByKind[currentStep]}
                      catalogue={catalogue}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={selectBlock}
                      onAddConnectedBlock={handleAddConnectedBlock}
                      onBlockClick={handleCardBlockClick}
                      onAddBlock={
                        availableFactories.length > 0
                          ? () =>
                              handleAddBlock(availableFactories[0].factoryId)
                          : undefined
                      }
                    />
                  ) : (
                    /* Single card when only one block */
                    blocksByKind[currentStep].map(({ id }) => (
                      <BlockInstanceCard
                        key={id}
                        instanceId={id}
                        catalogue={catalogue}
                        isSelected={selectedBlockId === id}
                        onAddConnectedBlock={handleAddConnectedBlock}
                        onBlockClick={handleCardBlockClick}
                      />
                    ))
                  )}
                </div>
              )}

              {availableFactories.length > 0 && (
                <div className="border-t pt-4">
                  <P className="mb-3 text-muted-foreground">
                    {blocksByKind[currentStep].length === 0
                      ? `Select a ${BLOCK_KIND_METADATA[currentStep].label.toLowerCase()} to get started:`
                      : `Add another ${BLOCK_KIND_METADATA[currentStep].label.toLowerCase()}:`}
                  </P>
                  <div className="grid gap-2">
                    {availableFactories.map(({ factoryId, factory }) => {
                      const IconComponent = getBlockKindIcon(factory.kind)
                      return (
                        <button
                          key={factoryIdToKey(factoryId)}
                          onClick={() => handleAddBlock(factoryId)}
                          className={cn(
                            'flex min-w-0 items-center gap-3 rounded-md border p-3 text-left',
                            'transition-colors hover:border-primary/50 hover:bg-muted/50',
                          )}
                        >
                          <IconComponent
                            className={cn(
                              'h-5 w-5 shrink-0',
                              BLOCK_KIND_METADATA[factory.kind].color,
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <P className="truncate font-medium">
                              {factory.title}
                            </P>
                            <P className="truncate text-muted-foreground">
                              {factory.description}
                            </P>
                          </div>
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {availableFactories.length === 0 &&
                blocksByKind[currentStep].length === 0 && (
                  <div className="py-8 text-center text-muted-foreground">
                    <P>
                      {currentStep === 'source'
                        ? 'Loading available sources...'
                        : `Complete the previous step to see available ${BLOCK_KIND_METADATA[currentStep].label.toLowerCase()}s.`}
                    </P>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pipeline diagram sidebar */}
      <PipelineSidebar>
        <PipelineDiagram
          catalogue={catalogue}
          currentStep={currentStep}
          onBlockClick={handleBlockClick}
          selectedBlockId={selectedBlockId}
        />
      </PipelineSidebar>
    </div>
  )
}
