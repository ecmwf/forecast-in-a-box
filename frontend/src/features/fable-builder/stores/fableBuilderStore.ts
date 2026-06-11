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

/** Max number of `fable` snapshots retained on the undo stack. Oldest entries
 * are evicted once the bound is reached. */
const MAX_HISTORY = 100
/** Coalesce window for repeated same-key edits (typing in a config field).
 * Within this window the meta is refreshed but no new snapshot is pushed. */
const HISTORY_COALESCE_MS = 500

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

function replaceBlockConfigurationRestrictions(
  current: Record<BlockInstanceId, Record<string, string>>,
  blockId: BlockInstanceId,
  restrictions: Record<string, string> | undefined,
): Record<BlockInstanceId, Record<string, string>> {
  const next = { ...current }
  if (restrictions && Object.keys(restrictions).length > 0) {
    next[blockId] = restrictions
  } else {
    delete next[blockId]
  }
  return next
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
  /** Per-block restrictions captured at add/connect time so the ConfigPanel
   * has them immediately, before the next /blueprint/expand round-trip. */
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
  /** Bounded undo/redo of `fable` snapshots. Selection, panel toggles, and
   * viewport state deliberately do NOT participate. */
  past: ReadonlyArray<FableBuilderV1>
  future: ReadonlyArray<FableBuilderV1>
  /** Coalescing scratchpad. Same-key edits within `HISTORY_COALESCE_MS`
   * refresh `t` without pushing a new snapshot — so a typing burst collapses
   * to a single undo step. Internal; do not read from React. */
  _historyMeta: { key: string | null; t: number }
  /** When non-null, every tracked mutation collapses into a single undo step
   * (regardless of the time window). UI flows that fire multiple actions
   * atomically — drag-drop with splice, popover add with splice — wrap their
   * sequence in `beginHistoryTransaction` / `endHistoryTransaction`. */
  _currentTransactionKey: string | null

  setFable: (fable: FableBuilderV1, id?: string | null) => void
  setFableName: (name: string) => void
  /**
   * Initialise the editor with a preset-instantiated builder.
   * The fable is treated as a brand-new unsaved document: `fableId` is null,
   * `isDirty` is true, and `step` is set to `'edit'` so the user lands
   * directly in the canvas rather than the setup wizard.
   */
  setFableFromPresetInstance: (builder: FableBuilderV1, presetName: string) => void
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
  undo: () => void
  redo: () => void
  beginHistoryTransaction: () => void
  endHistoryTransaction: () => void
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
    blockConfigurationRestrictions: {} as Record<
      BlockInstanceId,
      Record<string, string>
    >,
    isValidating: false,
    lastValidatedAt: null,
    isDirty: false,
    lastSavedAt: null,
    draftWritePending: false,
    submitDialogOpen: false,
    draggedFactory: null,
    past: [] as ReadonlyArray<FableBuilderV1>,
    future: [] as ReadonlyArray<FableBuilderV1>,
    _historyMeta: { key: null as string | null, t: 0 },
    _currentTransactionKey: null as string | null,
  }
}

export const useFableBuilderStore = create<FableBuilderState>()(
  devtools(
    persist(
      // `subscribeWithSelector` lets useDraftPersistence subscribe to just the
      // slices it cares about instead of running its dirty-check on every
      // unrelated state change.
      subscribeWithSelector((set, get) => {
        /** Functional update: reads the latest `state` so a rapid write burst
         * can't read a stale `fable` and drop an earlier update. */
        function applyBlockConfigUpdate(
          instanceId: BlockInstanceId,
          values: Record<string, string>,
        ): void {
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
          })
        }

        /** Push the current `fable` onto the undo stack before a mutation.
         * Coalesces when (a) inside an open transaction with a matching key,
         * or (b) the same `coalesceKey` was seen within `HISTORY_COALESCE_MS`
         * (typing-burst collapse). Always clears `future` — a new edit
         * invalidates redo. */
        function pushHistory(coalesceKey?: string): void {
          const { fable, past, _historyMeta, _currentTransactionKey } = get()
          const now = Date.now()
          // The active transaction (if any) overrides the caller's key so all
          // actions in the transaction share a single coalesce target.
          const effectiveKey = _currentTransactionKey ?? coalesceKey
          const inTransaction = _currentTransactionKey !== null
          if (
            effectiveKey !== undefined &&
            _historyMeta.key === effectiveKey &&
            (inTransaction || now - _historyMeta.t < HISTORY_COALESCE_MS)
          ) {
            set({
              _historyMeta: { key: effectiveKey, t: now },
              future: [],
            })
            return
          }
          // Bounded: drop oldest snapshot once we'd exceed MAX_HISTORY.
          const start =
            past.length >= MAX_HISTORY ? past.length - MAX_HISTORY + 1 : 0
          set({
            past: [...past.slice(start), fable],
            future: [],
            _historyMeta: { key: effectiveKey ?? null, t: now },
          })
        }

        return {
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
              // Loading a different fable invalidates the entire history.
              past: [],
              future: [],
              _historyMeta: { key: null, t: 0 },
              _currentTransactionKey: null,
            }),

          setFableName: (name) => set({ fableName: name, isDirty: true }),

          setFableFromPresetInstance: (builder, presetName) =>
            set({
              fable: builder,
              fableId: null,
              fableVersion: null,
              fableName: presetName,
              isDirty: true,
              step: 'edit',
              selectedBlockId: null,
              validationState: null,
              blockConfigurationRestrictions: {},
              // A preset-instantiated fable starts with a clean history.
              past: [],
              future: [],
              _historyMeta: { key: null, t: 0 },
              _currentTransactionKey: null,
            }),

          newFable: () =>
            set({
              ...createInitialState(),
              mode: get().mode,
              isPaletteOpen: get().isPaletteOpen,
              isConfigPanelOpen: get().isConfigPanelOpen,
            }),

          addBlock: (factoryId, factory) => {
            pushHistory()
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

          // Single-key update coalesces consecutive edits to the same option
          // into one undo step (so a typing burst collapses).
          updateBlockConfig: (instanceId, configKey, value) => {
            pushHistory(`config:${instanceId}:${configKey}`)
            applyBlockConfigUpdate(instanceId, { [configKey]: value })
          },

          updateBlockConfigBatch: (instanceId, values) => {
            // Batched edits are distinct undo steps — no coalesce key.
            pushHistory()
            applyBlockConfigUpdate(instanceId, values)
          },

          removeBlock: (instanceId) => {
            pushHistory()
            const { fable, selectedBlockId } = get()
            const { [instanceId]: _removed, ...remainingBlocks } = fable.blocks
            const {
              [instanceId]: _removedRestrictions,
              ...remainingRestrictions
            } = get().blockConfigurationRestrictions

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
            pushHistory()
            const { fable, selectedBlockId } = get()

            const downstreamBlocks = findDownstreamBlocks(
              instanceId,
              fable.blocks,
            )
            const toRemove = new Set([instanceId, ...downstreamBlocks])

            const remainingBlocks: Record<BlockInstanceId, BlockInstance> = {}
            const remainingRestrictions = {
              ...get().blockConfigurationRestrictions,
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
            pushHistory()
            const { fable } = get()
            const block = fable.blocks[instanceId]
            const restrictions = get().blockConfigurationRestrictions[
              instanceId
            ] as Record<string, string> | undefined
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
              blockConfigurationRestrictions:
                replaceBlockConfigurationRestrictions(
                  state.blockConfigurationRestrictions,
                  newInstanceId,
                  restrictions,
                ),
            }))

            return newInstanceId
          },

          duplicateBlockWithChildren: (instanceId) => {
            pushHistory()
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
            pushHistory()
            const { fable, validationState } = get()
            const block = fable.blocks[targetBlockId]
            const restrictions =
              validationState?.blockStates[sourceBlockId]
                ?.possibleExpansionRestrictions[
                factoryIdToKey(block.factory_id)
              ]
            const nextRestrictions = replaceBlockConfigurationRestrictions(
              get().blockConfigurationRestrictions,
              targetBlockId,
              restrictions,
            )

            set({
              fable: {
                ...fable,
                blocks: {
                  ...fable.blocks,
                  [targetBlockId]: {
                    ...block,
                    input_ids: {
                      ...block.input_ids,
                      [inputName]: sourceBlockId,
                    },
                  },
                },
              },
              isDirty: true,
              validationState: null,
              blockConfigurationRestrictions: nextRestrictions,
            })
          },

          disconnectBlock: (targetBlockId, inputName) => {
            pushHistory()
            const { fable } = get()
            const block = fable.blocks[targetBlockId]
            const { [inputName]: _removed, ...remainingInputs } =
              block.input_ids

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
              blockConfigurationRestrictions:
                replaceBlockConfigurationRestrictions(
                  get().blockConfigurationRestrictions,
                  targetBlockId,
                  undefined,
                ),
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
          setLayoutDirection: (direction) =>
            set({ layoutDirection: direction }),
          setNodesLocked: (locked) => set({ nodesLocked: locked }),

          setLocalGlyph: (key, value) => {
            // Coalesce typing in the same local glyph into one undo step.
            pushHistory(`localGlyph:${key}`)
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
            pushHistory()
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
              // Fresh validation supersedes the optimistic in-flight cache.
              ...(state ? { blockConfigurationRestrictions: {} } : {}),
            }),
          setBlockConfigurationRestrictions: (blockId, restrictions) =>
            set((state) => ({
              blockConfigurationRestrictions:
                replaceBlockConfigurationRestrictions(
                  state.blockConfigurationRestrictions,
                  blockId,
                  restrictions,
                ),
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

          undo: () => {
            const { fable, past, future, selectedBlockId } = get()
            if (past.length === 0) return
            const previous = past[past.length - 1]
            set({
              fable: previous,
              past: past.slice(0, -1),
              future: [...future, fable],
              // Drop coalesce state so the next edit starts a fresh snapshot.
              _historyMeta: { key: null, t: 0 },
              // Clear selection if the restored fable no longer has it.
              selectedBlockId:
                selectedBlockId &&
                (previous.blocks[selectedBlockId] as BlockInstance | undefined)
                  ? selectedBlockId
                  : null,
              isDirty: true,
              validationState: null,
            })
          },

          beginHistoryTransaction: () => {
            // Unique token so stale prior `_historyMeta.key` can't pollute
            // a freshly opened transaction's coalesce check.
            const key = `tx:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
            set({ _currentTransactionKey: key })
          },

          endHistoryTransaction: () => {
            // Reset meta so the next standalone edit pushes a fresh snapshot
            // rather than coalescing into the now-closed transaction.
            set({
              _currentTransactionKey: null,
              _historyMeta: { key: null, t: 0 },
            })
          },

          redo: () => {
            const { fable, past, future, selectedBlockId } = get()
            if (future.length === 0) return
            const next = future[future.length - 1]
            set({
              fable: next,
              past: [...past, fable],
              future: future.slice(0, -1),
              _historyMeta: { key: null, t: 0 },
              selectedBlockId:
                selectedBlockId &&
                (next.blocks[selectedBlockId] as BlockInstance | undefined)
                  ? selectedBlockId
                  : null,
              isDirty: true,
              validationState: null,
            })
          },
        }
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
