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
import { devtools, persist } from 'zustand/middleware'
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
  generateBlockInstanceId,
} from '@/api/types/fable.types'

export type BuilderMode = 'graph' | 'form'
export type BuilderStep = 'edit' | 'review'
export type EdgeStyle = 'bezier' | 'smoothstep' | 'step'
export type { LayoutDirection } from '@/features/fable-builder/utils/layout-blocks'

/**
 * Gets the default layout direction based on screen aspect ratio.
 * Landscape screens (width > height) use left-to-right (LR).
 * Portrait screens (height >= width) use top-to-bottom (TB).
 */
function getDefaultLayoutDirection(): LayoutDirection {
  if (typeof window === 'undefined') return 'TB'
  return window.innerWidth > window.innerHeight ? 'LR' : 'TB'
}

interface FableBuilderState {
  fable: FableBuilderV1
  fableId: string | null
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
  isValidating: boolean
  lastValidatedAt: number | null
  isDirty: boolean
  lastSavedAt: number | null

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
  clearSelection: () => void
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
  setValidationState: (state: FableValidationState | null) => void
  setIsValidating: (validating: boolean) => void
  markSaved: (id: string, name?: string) => void
  markDirty: () => void
  reset: () => void
}

const initialState = {
  fable: createEmptyFable(),
  fableId: null,
  fableName: 'Untitled Configuration',
  mode: 'graph' as BuilderMode,
  step: 'edit' as BuilderStep,
  selectedBlockId: null,
  isPaletteOpen: true,
  isConfigPanelOpen: true,
  isMobilePaletteOpen: false,
  isMobileConfigOpen: false,
  isMiniMapOpen: true,
  fitViewTrigger: 0,
  edgeStyle: 'bezier' as EdgeStyle,
  autoLayout: true,
  layoutDirection: getDefaultLayoutDirection(),
  nodesLocked: true,
  validationState: null,
  isValidating: false,
  lastValidatedAt: null,
  isDirty: false,
  lastSavedAt: null,
}

export const useFableBuilderStore = create<FableBuilderState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setFable: (fable, id = null) =>
          set({
            fable,
            fableId: id,
            isDirty: false,
            selectedBlockId: null,
            validationState: null,
            step: 'edit',
          }),

        setFableName: (name) => set({ fableName: name, isDirty: true }),

        newFable: () =>
          set({
            ...initialState,
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

        updateBlockConfig: (instanceId, configKey, value) => {
          const { fable } = get()
          const block = fable.blocks[instanceId]

          set({
            fable: {
              ...fable,
              blocks: {
                ...fable.blocks,
                [instanceId]: {
                  ...block,
                  configuration_values: {
                    ...block.configuration_values,
                    [configKey]: value,
                  },
                },
              },
            },
            isDirty: true,
            validationState: null,
          })
        },

        updateBlockConfigBatch: (instanceId, values) => {
          const { fable } = get()
          const block = fable.blocks[instanceId]

          set({
            fable: {
              ...fable,
              blocks: {
                ...fable.blocks,
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
          })
        },

        removeBlock: (instanceId) => {
          const { fable, selectedBlockId } = get()
          const { [instanceId]: _removed, ...remainingBlocks } = fable.blocks

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
          })
        },

        removeBlockCascade: (instanceId) => {
          const { fable, selectedBlockId } = get()

          const findDownstreamBlocks = (
            startId: BlockInstanceId,
            blocks: Record<BlockInstanceId, BlockInstance>,
          ): Set<BlockInstanceId> => {
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

          const downstreamBlocks = findDownstreamBlocks(
            instanceId,
            fable.blocks,
          )
          const toRemove = new Set([instanceId, ...downstreamBlocks])

          const remainingBlocks: Record<BlockInstanceId, BlockInstance> = {}
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
          })
        },

        duplicateBlock: (instanceId) => {
          const { fable } = get()
          const block = fable.blocks[instanceId]
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
          }))

          return newInstanceId
        },

        duplicateBlockWithChildren: (instanceId) => {
          const { fable } = get()

          // Find all downstream blocks (same logic as removeBlockCascade)
          const findDownstreamBlocks = (
            startId: BlockInstanceId,
            blocks: Record<BlockInstanceId, BlockInstance>,
          ): Set<BlockInstanceId> => {
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
          const { fable } = get()
          const block = fable.blocks[targetBlockId]

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
          })
        },

        selectBlock: (blockId) =>
          set({
            selectedBlockId: blockId,
            isConfigPanelOpen: blockId !== null,
          }),

        clearSelection: () => set({ selectedBlockId: null }),

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

        setValidationState: (state) =>
          set({
            validationState: state,
            lastValidatedAt: state ? Date.now() : null,
          }),
        setIsValidating: (validating) => set({ isValidating: validating }),

        markSaved: (id, name) =>
          set({
            fableId: id,
            isDirty: false,
            lastSavedAt: Date.now(),
            ...(name !== undefined && { fableName: name }),
          }),
        markDirty: () => set({ isDirty: true }),

        reset: () => set(initialState),
      }),
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

export function useBlockCount(): number {
  return useFableBuilderStore((state) => Object.keys(state.fable.blocks).length)
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

export function useIsValid(): boolean {
  return useFableBuilderStore(
    (state) => state.validationState?.isValid ?? false,
  )
}
