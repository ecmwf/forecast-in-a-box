/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { create } from 'zustand'
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware'
import type {
  BlockFactory,
  BlockInstance,
  BlockInstanceId,
  FableBuilderV1,
  FableValidationState,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import type { LayoutDirection } from '@/features/fable-builder/utils/layout-blocks'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'
import {
  createBlockInstance,
  createEmptyFable,
  factoryIdToKey,
  generateBlockInstanceId,
} from '@/api/types/fable.types'

export type BuilderMode = 'graph' | 'form'
export type BuilderStep = 'edit' | 'review'
export type EdgeStyle = 'bezier' | 'smoothstep' | 'step'
export type { LayoutDirection } from '@/features/fable-builder/utils/layout-blocks'

/** A block factory being dragged from the palette onto the canvas. */
export interface DraggedFactory {
  id: PluginBlockFactoryId
  factory: BlockFactory
}

/**
 * Gets the default layout direction based on screen aspect ratio.
 * Landscape screens (width > height) use left-to-right (LR).
 * Portrait screens (height >= width) use top-to-bottom (TB).
 */
function getDefaultLayoutDirection(): LayoutDirection {
  return window.innerWidth > window.innerHeight ? 'LR' : 'TB'
}

/**
 * Breadth-first walk of every block transitively downstream of `startId`
 * (i.e. blocks that consume its output, directly or via intermediaries).
 * Shared by `removeBlockCascade` and `duplicateBlockWithChildren`.
 */
function findDownstreamBlocks(
  startId: BlockInstanceId,
  blocks: Record<BlockInstanceId, BlockInstance>,
): Set<BlockInstanceId> {
  const downstream = new Set<BlockInstanceId>()
  const queue = [startId]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    for (const [blockId, block] of Object.entries(blocks)) {
      if (downstream.has(blockId)) continue
      const hasCurrentAsInput = Object.values(block.input_ids).some(
        (sourceId) => sourceId === currentId,
      )
      if (hasCurrentAsInput) {
        downstream.add(blockId)
        queue.push(blockId)
      }
    }
  }
  return downstream
}

interface FableBuilderState {
  fable: FableBuilderV1
  fableId: string | null
  fableVersion: number | null
  fableName: string
  mode: BuilderMode
  step: BuilderStep
  selectedBlockId: BlockInstanceId | null
  isPaletteOpen: boolean
  isConfigPanelOpen: boolean
  isMobilePaletteOpen: boolean
  isMobileConfigOpen: boolean
  isMiniMapOpen: boolean
  fitViewTrigger: number
  edgeStyle: EdgeStyle
  autoLayout: boolean
  layoutDirection: LayoutDirection
  nodesLocked: boolean
  validationState: FableValidationState | null
  blockConfigurationRestrictions: Record<
    BlockInstanceId,
    Record<string, string>
  >
  isValidating: boolean
  lastValidatedAt: number | null
  isDirty: boolean
  lastSavedAt: number | null
  /** True while the 2 s localStorage draft debounce is pending. Set by
   *  `useDraftPersistence`; read by the DraftStatus indicator. */
  draftWritePending: boolean
  submitDialogOpen: boolean
  /** Palette block being dragged onto the canvas; null when idle. Not persisted. */
  draggedFactory: DraggedFactory | null

  setFable: (fable: FableBuilderV1, id?: string | null) => void
  setFableName: (name: string) => void
  newFable: () => void
  addBlock: (
    factoryId: PluginBlockFactoryId,
    factory: BlockFactory,
  ) => BlockInstanceId
  updateBlockConfig: (
    instanceId: BlockInstanceId,
    configKey: string,
    value: string,
  ) => void
  updateBlockConfigBatch: (
    instanceId: BlockInstanceId,
    values: Record<string, string>,
  ) => void
  removeBlock: (instanceId: BlockInstanceId) => void
  removeBlockCascade: (instanceId: BlockInstanceId) => void
  duplicateBlock: (instanceId: BlockInstanceId) => BlockInstanceId
  duplicateBlockWithChildren: (
    instanceId: BlockInstanceId,
  ) => Record<BlockInstanceId, BlockInstanceId>
  connectBlocks: (
    targetBlockId: BlockInstanceId,
    inputName: string,
    sourceBlockId: BlockInstanceId,
  ) => void
  disconnectBlock: (targetBlockId: BlockInstanceId, inputName: string) => void
  selectBlock: (blockId: BlockInstanceId | null) => void
  setMode: (mode: BuilderMode) => void
  setStep: (step: BuilderStep) => void
  togglePalette: () => void
  toggleConfigPanel: () => void
  setPaletteOpen: (open: boolean) => void
  setConfigPanelOpen: (open: boolean) => void
  setMobilePaletteOpen: (open: boolean) => void
  setMobileConfigOpen: (open: boolean) => void
  openMobileConfig: (blockId: BlockInstanceId) => void
  setMiniMapOpen: (open: boolean) => void
  toggleMiniMap: () => void
  triggerFitView: () => void
  setEdgeStyle: (style: EdgeStyle) => void
  setAutoLayout: (enabled: boolean) => void
  setLayoutDirection: (direction: LayoutDirection) => void
  setNodesLocked: (locked: boolean) => void
  setLocalGlyph: (key: string, value: string) => void
  removeLocalGlyph: (key: string) => void
  setValidationState: (state: FableValidationState | null) => void
  setBlockConfigurationRestrictions: (
    blockId: BlockInstanceId,
    restrictions: Record<string, string>,
  ) => void
  setIsValidating: (validating: boolean) => void
  setSubmitDialogOpen: (open: boolean) => void
  setDraggedFactory: (dragged: DraggedFactory | null) => void
  markSaved: (id: string, version: number, name?: string) => void
  /**
   * Mark the current fable as submitted (one-off run or schedule created).
   * Clears the dirty flag and bumps `lastSavedAt` so the draft-persistence
   * hook wipes the localStorage draft — but leaves the fable on screen so
   * the user can tweak and re-submit.
   */
  markSubmitted: () => void
  reset: () => void
}

/**
 * Builds the store's initial state. A function (not a module-scope const) so
 * each call — including `reset()` — yields a fresh object graph.
 */
function createInitialState() {
  return {
    fable: createEmptyFable(),
    fableId: null,
    fableVersion: null,
    // Blank by default; FableBuilderHeader renders a translated placeholder.
    fableName: '',
    mode: 'graph' as BuilderMode,
    step: 'edit' as BuilderStep,
    selectedBlockId: null,
    isPaletteOpen: true,
    isConfigPanelOpen: true,
    isMobilePaletteOpen: false,
    isMobileConfigOpen: false,
    isMiniMapOpen: true,
    fitViewTrigger: 0,
    // Orthogonal by default, matching the execution details page.
    edgeStyle: 'smoothstep' as EdgeStyle,
    autoLayout: true,
    layoutDirection: getDefaultLayoutDirection(),
    nodesLocked: true,
    validationState: null,
    blockConfigurationRestrictions: {},
    isValidating: false,
    lastValidatedAt: null,
    isDirty: false,
    lastSavedAt: null,
    draftWritePending: false,
    submitDialogOpen: false,
    draggedFactory: null,
  }
}

export const useFableBuilderStore = create<FableBuilderState>()(
  devtools(
    persist(
      // `subscribeWithSelector` lets useDraftPersistence subscribe to just the
      // slices it cares about instead of running its dirty-check on every
      // unrelated state change.
      subscribeWithSelector((set, get) => ({
        ...createInitialState(),

        setFable: (fable, id = null) =>
          set({
            fable,
            fableId: id,
            fableVersion: null,
            isDirty: false,
            selectedBlockId: null,
            validationState: null,
            blockConfigurationRestrictions: {},
            step: 'edit',
          }),

        setFableName: (name) => set({ fableName: name, isDirty: true }),

        newFable: () =>
          set({
            ...createInitialState(),
            mode: get().mode,
            isPaletteOpen: get().isPaletteOpen,
            isConfigPanelOpen: get().isConfigPanelOpen,
          }),

        addBlock: (factoryId, factory) => {
          const instanceId = generateBlockInstanceId()
          const instance = createBlockInstance(factoryId, factory)

          set((state) => ({
            fable: {
              ...state.fable,
              blocks: {
                ...state.fable.blocks,
                [instanceId]: instance,
              },
            },
            selectedBlockId: instanceId,
            isConfigPanelOpen: true,
            isMobilePaletteOpen: false,
            isDirty: true,
            validationState: null,
          }))

          return instanceId
        },

        // Single-key update is just a one-entry batch.
        updateBlockConfig: (instanceId, configKey, value) =>
          get().updateBlockConfigBatch(instanceId, { [configKey]: value }),

        updateBlockConfigBatch: (instanceId, values) =>
          // Functional update: reads the latest `state` so a rapid write burst
          // can't read a stale `fable` and drop an earlier update.
          set((state) => {
            const block = state.fable.blocks[instanceId]
            return {
              fable: {
                ...state.fable,
                blocks: {
                  ...state.fable.blocks,
                  [instanceId]: {
                    ...block,
                    configuration_values: {
                      ...block.configuration_values,
                      ...values,
                    },
                  },
                },
              },
              isDirty: true,
              validationState: null,
            }
          }),

        removeBlock: (instanceId) => {
          const { fable, selectedBlockId } = get()
          const { [instanceId]: _removed, ...remainingBlocks } = fable.blocks
          const {
            [instanceId]: _removedRestrictions,
            ...remainingRestrictions
          } = get().blockConfigurationRestrictions ?? {}

          const updatedBlocks: Record<BlockInstanceId, BlockInstance> = {}
          for (const [id, block] of Object.entries(remainingBlocks)) {
            const updatedInputIds: Record<string, string> = {}
            for (const [inputName, sourceId] of Object.entries(
              block.input_ids,
            )) {
              if (sourceId !== instanceId) {
                updatedInputIds[inputName] = sourceId
              }
            }
            updatedBlocks[id] = { ...block, input_ids: updatedInputIds }
          }

          set({
            fable: { ...fable, blocks: updatedBlocks },
            selectedBlockId:
              selectedBlockId === instanceId ? null : selectedBlockId,
            isDirty: true,
            validationState: null,
            blockConfigurationRestrictions: remainingRestrictions,
          })
        },

        removeBlockCascade: (instanceId) => {
          const { fable, selectedBlockId } = get()

          const downstreamBlocks = findDownstreamBlocks(
            instanceId,
            fable.blocks,
          )
          const toRemove = new Set([instanceId, ...downstreamBlocks])

          const remainingBlocks: Record<BlockInstanceId, BlockInstance> = {}
          const remainingRestrictions = {
            ...(get().blockConfigurationRestrictions ?? {}),
          }
          for (const id of toRemove) {
            delete remainingRestrictions[id]
          }
          for (const [id, block] of Object.entries(fable.blocks)) {
            if (!toRemove.has(id)) {
              const cleanedInputIds: Record<string, string> = {}
              for (const [inputName, sourceId] of Object.entries(
                block.input_ids,
              )) {
                if (!toRemove.has(sourceId)) {
                  cleanedInputIds[inputName] = sourceId
                }
              }
              remainingBlocks[id] = { ...block, input_ids: cleanedInputIds }
            }
          }

          set({
            fable: { ...fable, blocks: remainingBlocks },
            selectedBlockId: toRemove.has(selectedBlockId ?? '')
              ? null
              : selectedBlockId,
            isDirty: true,
            validationState: null,
            blockConfigurationRestrictions: remainingRestrictions,
          })
        },

        duplicateBlock: (instanceId) => {
          const { fable } = get()
          const block = fable.blocks[instanceId]
          const restrictions = get().blockConfigurationRestrictions[instanceId]
          const newInstanceId = generateBlockInstanceId()
          const duplicatedBlock: BlockInstance = {
            factory_id: block.factory_id,
            configuration_values: { ...block.configuration_values },
            input_ids: { ...block.input_ids },
          }

          set((state) => ({
            fable: {
              ...state.fable,
              blocks: {
                ...state.fable.blocks,
                [newInstanceId]: duplicatedBlock,
              },
            },
            selectedBlockId: newInstanceId,
            isDirty: true,
            validationState: null,
            blockConfigurationRestrictions: restrictions
              ? {
                  ...(state.blockConfigurationRestrictions ?? {}),
                  [newInstanceId]: restrictions,
                }
              : state.blockConfigurationRestrictions,
          }))

          return newInstanceId
        },

        duplicateBlockWithChildren: (instanceId) => {
          const { fable } = get()

          const downstreamBlocks = findDownstreamBlocks(
            instanceId,
            fable.blocks,
          )
          const toDuplicate = [instanceId, ...downstreamBlocks]

          // Create ID mapping for all blocks to duplicate
          const idMapping: Record<BlockInstanceId, BlockInstanceId> = {}
          for (const id of toDuplicate) {
            idMapping[id] = generateBlockInstanceId()
          }

          // Duplicate each block with updated input_ids
          const newBlocks: Record<BlockInstanceId, BlockInstance> = {}
          for (const id of toDuplicate) {
            const block = fable.blocks[id]
            const newInputIds: Record<string, string> = {}

            // Update input_ids to point to new IDs if the source is also being duplicated
            for (const [inputName, sourceId] of Object.entries(
              block.input_ids,
            )) {
              if (idMapping[sourceId]) {
                newInputIds[inputName] = idMapping[sourceId]
              } else {
                newInputIds[inputName] = sourceId
              }
            }

            newBlocks[idMapping[id]] = {
              factory_id: block.factory_id,
              configuration_values: { ...block.configuration_values },
              input_ids: newInputIds,
            }
          }

          set((state) => ({
            fable: {
              ...state.fable,
              blocks: {
                ...state.fable.blocks,
                ...newBlocks,
              },
            },
            selectedBlockId: idMapping[instanceId],
            isDirty: true,
            validationState: null,
          }))

          return idMapping
        },

        connectBlocks: (targetBlockId, inputName, sourceBlockId) => {
          const { fable, validationState } = get()
          const block = fable.blocks[targetBlockId]
          const restrictions =
            validationState?.blockStates[sourceBlockId]
              ?.possibleExpansionRestrictions[factoryIdToKey(block.factory_id)]
          const nextRestrictions =
            restrictions && Object.keys(restrictions).length > 0
              ? {
                  ...(get().blockConfigurationRestrictions ?? {}),
                  [targetBlockId]: restrictions,
                }
              : get().blockConfigurationRestrictions

          set({
            fable: {
              ...fable,
              blocks: {
                ...fable.blocks,
                [targetBlockId]: {
                  ...block,
                  input_ids: { ...block.input_ids, [inputName]: sourceBlockId },
                },
              },
            },
            isDirty: true,
            validationState: null,
            blockConfigurationRestrictions: nextRestrictions,
          })
        },

        disconnectBlock: (targetBlockId, inputName) => {
          const { fable } = get()
          const block = fable.blocks[targetBlockId]
          const { [inputName]: _removed, ...remainingInputs } = block.input_ids

          set({
            fable: {
              ...fable,
              blocks: {
                ...fable.blocks,
                [targetBlockId]: { ...block, input_ids: remainingInputs },
              },
            },
            isDirty: true,
            validationState: null,
            blockConfigurationRestrictions: {
              ...(get().blockConfigurationRestrictions ?? {}),
              [targetBlockId]: {},
            },
          })
        },

        selectBlock: (blockId) =>
          set({
            selectedBlockId: blockId,
            // Sidebar stays open even on deselect (blockId === null) —
            // it shows a "Select a block to configure" placeholder.
            // User closes it explicitly via toggleConfigPanel.
            isConfigPanelOpen: true,
          }),

        setMode: (mode) => set({ mode }),
        setStep: (step) => set({ step }),
        togglePalette: () =>
          set((state) => ({ isPaletteOpen: !state.isPaletteOpen })),
        toggleConfigPanel: () =>
          set((state) => ({ isConfigPanelOpen: !state.isConfigPanelOpen })),
        setPaletteOpen: (open) => set({ isPaletteOpen: open }),
        setConfigPanelOpen: (open) => set({ isConfigPanelOpen: open }),
        setMobilePaletteOpen: (open) => set({ isMobilePaletteOpen: open }),
        setMobileConfigOpen: (open) => set({ isMobileConfigOpen: open }),
        openMobileConfig: (blockId) =>
          set({ selectedBlockId: blockId, isMobileConfigOpen: true }),
        setMiniMapOpen: (open) => set({ isMiniMapOpen: open }),
        toggleMiniMap: () =>
          set((state) => ({ isMiniMapOpen: !state.isMiniMapOpen })),
        triggerFitView: () =>
          set((state) => ({ fitViewTrigger: state.fitViewTrigger + 1 })),
        setEdgeStyle: (style) => set({ edgeStyle: style }),
        setAutoLayout: (enabled) => set({ autoLayout: enabled }),
        setLayoutDirection: (direction) => set({ layoutDirection: direction }),
        setNodesLocked: (locked) => set({ nodesLocked: locked }),

        setLocalGlyph: (key, value) => {
          const { fable } = get()
          set({
            fable: {
              ...fable,
              local_glyphs: { ...(fable.local_glyphs ?? {}), [key]: value },
            },
            isDirty: true,
            validationState: null,
          })
        },

        removeLocalGlyph: (key) => {
          const { fable } = get()
          const { [key]: _removed, ...rest } = fable.local_glyphs ?? {}
          set({
            fable: { ...fable, local_glyphs: rest },
            isDirty: true,
            validationState: null,
          })
        },

        setValidationState: (state) =>
          set({
            validationState: state,
            lastValidatedAt: state ? Date.now() : null,
          }),
        setBlockConfigurationRestrictions: (blockId, restrictions) =>
          set((state) => ({
            blockConfigurationRestrictions: {
              ...(state.blockConfigurationRestrictions ?? {}),
              [blockId]: restrictions,
            },
          })),
        setIsValidating: (validating) => set({ isValidating: validating }),
        setSubmitDialogOpen: (open) => set({ submitDialogOpen: open }),
        setDraggedFactory: (dragged) => set({ draggedFactory: dragged }),

        markSaved: (id, version, name) =>
          set({
            fableId: id,
            fableVersion: version,
            isDirty: false,
            lastSavedAt: Date.now(),
            ...(name !== undefined && { fableName: name }),
          }),
        markSubmitted: () => set({ isDirty: false, lastSavedAt: Date.now() }),

        reset: () => set(createInitialState()),
      })),
      {
        name: STORAGE_KEYS.stores.fableBuilder,
        version: STORE_VERSIONS.fableBuilder,
        migrate: (persistedState, version) => {
          // v2: Removed configDisplayMode, added isMiniMapOpen
          if (version < 2) {
            const { configDisplayMode: _removed, ...rest } =
              persistedState as Record<string, unknown>
            return { ...rest, isMiniMapOpen: true }
          }
          return persistedState as {
            mode: BuilderMode
            isPaletteOpen: boolean
            isConfigPanelOpen: boolean
            isMiniMapOpen: boolean
            edgeStyle: EdgeStyle
            autoLayout: boolean
            layoutDirection: LayoutDirection
            nodesLocked: boolean
          }
        },
        partialize: (state) => ({
          mode: state.mode,
          isPaletteOpen: state.isPaletteOpen,
          isConfigPanelOpen: state.isConfigPanelOpen,
          isMiniMapOpen: state.isMiniMapOpen,
          edgeStyle: state.edgeStyle,
          autoLayout: state.autoLayout,
          layoutDirection: state.layoutDirection,
          nodesLocked: state.nodesLocked,
        }),
      },
    ),
    { name: 'FableBuilderStore' },
  ),
)

export function useSelectedBlock(): BlockInstance | null {
  return useFableBuilderStore((state) => {
    if (!state.selectedBlockId) return null
    return state.fable.blocks[state.selectedBlockId] ?? null
  })
}

export function useBlockInstances(): Record<BlockInstanceId, BlockInstance> {
  return useFableBuilderStore((state) => state.fable.blocks)
}

export function useHasBlocks(): boolean {
  return useFableBuilderStore(
    (state) => Object.keys(state.fable.blocks).length > 0,
  )
}

export function useBlockValidation(blockId: BlockInstanceId) {
  return useFableBuilderStore((state) => {
    if (!state.validationState) return null
    return state.validationState.blockStates[blockId] ?? null
  })
}
