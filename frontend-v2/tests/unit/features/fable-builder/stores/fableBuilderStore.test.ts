/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { BlockFactory, FableBuilderV1 } from '@/api/types/fable.types'
import {
  useBlockCount,
  useFableBuilderStore,
  useHasBlocks,
  useIsValid,
} from '@/features/fable-builder/stores/fableBuilderStore'
import { createEmptyFable } from '@/api/types/fable.types'

const mockFactory: BlockFactory = {
  kind: 'source',
  title: 'Test Source',
  description: 'A test source block',
  configuration_options: {
    param1: {
      title: 'Parameter 1',
      description: 'A string parameter',
      value_type: 'string',
    },
  },
  inputs: [],
}

const mockFable: FableBuilderV1 = {
  blocks: {
    'block-1': {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'test' },
        factory: 'source',
      },
      configuration_values: { param1: 'value1' },
      input_ids: {},
    },
    'block-2': {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'test' },
        factory: 'transform',
      },
      configuration_values: {},
      input_ids: { input: 'block-1' },
    },
  },
}

describe('useFableBuilderStore', () => {
  beforeEach(() => {
    act(() => useFableBuilderStore.getState().reset())
  })

  describe('initial state', () => {
    it('has empty fable initially', () => {
      const state = useFableBuilderStore.getState()
      expect(state.fable).toEqual(createEmptyFable())
    })

    it('has null fableId initially', () => {
      expect(useFableBuilderStore.getState().fableId).toBeNull()
    })

    it('has default fableName', () => {
      expect(useFableBuilderStore.getState().fableName).toBe(
        'Untitled Configuration',
      )
    })

    it('has graph mode by default', () => {
      expect(useFableBuilderStore.getState().mode).toBe('graph')
    })

    it('has edit step by default', () => {
      expect(useFableBuilderStore.getState().step).toBe('edit')
    })

    it('has no selected block initially', () => {
      expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
    })

    it('is not dirty initially', () => {
      expect(useFableBuilderStore.getState().isDirty).toBe(false)
    })
  })

  describe('setFable', () => {
    it('sets fable data', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      expect(useFableBuilderStore.getState().fable).toEqual(mockFable)
    })

    it('sets fableId when provided', () => {
      act(() =>
        useFableBuilderStore.getState().setFable(mockFable, 'fable-123'),
      )
      expect(useFableBuilderStore.getState().fableId).toBe('fable-123')
    })

    it('clears selection when setting fable', () => {
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
    })

    it('clears validation state when setting fable', () => {
      act(() =>
        useFableBuilderStore.getState().setValidationState({
          isValid: true,
          globalErrors: [],
          blockStates: {},
          possibleSources: [],
        }),
      )
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      expect(useFableBuilderStore.getState().validationState).toBeNull()
    })

    it('resets isDirty to false', () => {
      act(() => useFableBuilderStore.getState().markDirty())
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      expect(useFableBuilderStore.getState().isDirty).toBe(false)
    })
  })

  describe('setFableName', () => {
    it('sets fable name', () => {
      act(() => useFableBuilderStore.getState().setFableName('My Forecast'))
      expect(useFableBuilderStore.getState().fableName).toBe('My Forecast')
    })

    it('marks as dirty', () => {
      act(() => useFableBuilderStore.getState().setFableName('My Forecast'))
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('newFable', () => {
    it('resets fable to empty', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      act(() => useFableBuilderStore.getState().newFable())
      expect(useFableBuilderStore.getState().fable).toEqual(createEmptyFable())
    })

    it('preserves mode setting', () => {
      act(() => useFableBuilderStore.getState().setMode('form'))
      act(() => useFableBuilderStore.getState().newFable())
      expect(useFableBuilderStore.getState().mode).toBe('form')
    })
  })

  describe('addBlock', () => {
    it('adds block to fable', () => {
      act(() =>
        useFableBuilderStore
          .getState()
          .addBlock(
            { plugin: { store: 'ecmwf', local: 'test' }, factory: 'source' },
            mockFactory,
          ),
      )
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(Object.keys(blocks).length).toBe(1)
    })

    it('returns new block instance id', () => {
      let blockId = ''
      act(() => {
        blockId = useFableBuilderStore
          .getState()
          .addBlock(
            { plugin: { store: 'ecmwf', local: 'test' }, factory: 'source' },
            mockFactory,
          )
      })
      expect(blockId).toBeTruthy()
      expect(
        useFableBuilderStore.getState().fable.blocks[blockId],
      ).toBeDefined()
    })

    it('selects new block', () => {
      let blockId = ''
      act(() => {
        blockId = useFableBuilderStore
          .getState()
          .addBlock(
            { plugin: { store: 'ecmwf', local: 'test' }, factory: 'source' },
            mockFactory,
          )
      })
      expect(useFableBuilderStore.getState().selectedBlockId).toBe(blockId)
    })

    it('marks as dirty', () => {
      act(() =>
        useFableBuilderStore
          .getState()
          .addBlock(
            { plugin: { store: 'ecmwf', local: 'test' }, factory: 'source' },
            mockFactory,
          ),
      )
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('removeBlock', () => {
    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
    })

    it('removes block from fable', () => {
      act(() => useFableBuilderStore.getState().removeBlock('block-1'))
      expect(
        useFableBuilderStore.getState().fable.blocks['block-1'],
      ).toBeUndefined()
    })

    it('removes references to deleted block from other blocks', () => {
      act(() => useFableBuilderStore.getState().removeBlock('block-1'))
      expect(
        useFableBuilderStore.getState().fable.blocks['block-2'].input_ids,
      ).toEqual({})
    })

    it('clears selection if deleted block was selected', () => {
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      act(() => useFableBuilderStore.getState().removeBlock('block-1'))
      expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
    })

    it('marks as dirty', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable)) // Reset dirty
      act(() => useFableBuilderStore.getState().removeBlock('block-1'))
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('removeBlockCascade', () => {
    const chainedFable: FableBuilderV1 = {
      blocks: {
        source: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'source',
          },
          configuration_values: {},
          input_ids: {},
        },
        transform: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'transform',
          },
          configuration_values: {},
          input_ids: { input: 'source' },
        },
        sink: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'sink',
          },
          configuration_values: {},
          input_ids: { dataset: 'transform' },
        },
        independent: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'other',
          },
          configuration_values: {},
          input_ids: {},
        },
      },
    }

    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(chainedFable))
    })

    it('removes the target block and all downstream dependents', () => {
      act(() => useFableBuilderStore.getState().removeBlockCascade('source'))
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(blocks['source']).toBeUndefined()
      expect(blocks['transform']).toBeUndefined()
      expect(blocks['sink']).toBeUndefined()
      expect(blocks['independent']).toBeDefined()
    })

    it('keeps blocks not in the dependency chain', () => {
      act(() => useFableBuilderStore.getState().removeBlockCascade('source'))
      expect(Object.keys(useFableBuilderStore.getState().fable.blocks)).toEqual(
        ['independent'],
      )
    })

    it('removes only the leaf when a leaf block is cascaded', () => {
      act(() => useFableBuilderStore.getState().removeBlockCascade('sink'))
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(blocks['source']).toBeDefined()
      expect(blocks['transform']).toBeDefined()
      expect(blocks['sink']).toBeUndefined()
    })

    it('cascades through multi-level chains correctly', () => {
      // Removing transform should also remove sink (which depends on transform)
      act(() => useFableBuilderStore.getState().removeBlockCascade('transform'))
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(blocks['transform']).toBeUndefined()
      expect(blocks['sink']).toBeUndefined()
      expect(blocks['source']).toBeDefined()
      expect(blocks['independent']).toBeDefined()
    })

    it('clears selection if selected block is in cascade', () => {
      act(() => useFableBuilderStore.getState().selectBlock('sink'))
      act(() => useFableBuilderStore.getState().removeBlockCascade('source'))
      expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
    })

    it('marks as dirty', () => {
      act(() => useFableBuilderStore.getState().removeBlockCascade('source'))
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('duplicateBlock', () => {
    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
    })

    it('creates a copy with a new instance id', () => {
      let newId: string | undefined
      act(() => {
        newId = useFableBuilderStore.getState().duplicateBlock('block-1')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(newId).toBeDefined()
      expect(newId).not.toBe('block-1')
      expect(blocks[newId!]).toBeDefined()
    })

    it('preserves factory_id and configuration_values', () => {
      let newId: string | undefined
      act(() => {
        newId = useFableBuilderStore.getState().duplicateBlock('block-1')
      })
      const original = mockFable.blocks['block-1']
      const copy = useFableBuilderStore.getState().fable.blocks[newId!]
      expect(copy.factory_id).toEqual(original.factory_id)
      expect(copy.configuration_values).toEqual(original.configuration_values)
    })

    it('preserves input_ids from original', () => {
      let newId: string | undefined
      act(() => {
        newId = useFableBuilderStore.getState().duplicateBlock('block-2')
      })
      const copy = useFableBuilderStore.getState().fable.blocks[newId!]
      expect(copy.input_ids).toEqual({ input: 'block-1' })
    })

    it('selects the new block', () => {
      let newId: string | undefined
      act(() => {
        newId = useFableBuilderStore.getState().duplicateBlock('block-1')
      })
      expect(useFableBuilderStore.getState().selectedBlockId).toBe(newId)
    })

    it('marks as dirty', () => {
      act(() => useFableBuilderStore.getState().duplicateBlock('block-1'))
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })

    it('does not affect the original block', () => {
      act(() => useFableBuilderStore.getState().duplicateBlock('block-1'))
      expect(useFableBuilderStore.getState().fable.blocks['block-1']).toEqual(
        mockFable.blocks['block-1'],
      )
    })
  })

  describe('duplicateBlockWithChildren', () => {
    const pipelineFable: FableBuilderV1 = {
      blocks: {
        source: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'source',
          },
          configuration_values: { model: 'aifs' },
          input_ids: {},
        },
        transform: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'transform',
          },
          configuration_values: { op: 'regrid' },
          input_ids: { input: 'source' },
        },
        sink: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'sink',
          },
          configuration_values: { path: '/out' },
          input_ids: { dataset: 'transform' },
        },
        external: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'test' },
            factory: 'other',
          },
          configuration_values: {},
          input_ids: {},
        },
      },
    }

    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(pipelineFable))
    })

    it('duplicates the source block and all downstream children', () => {
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('source')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      // Original 4 + 3 duplicated (source, transform, sink)
      expect(Object.keys(blocks)).toHaveLength(7)
      expect(idMapping!['source']).toBeDefined()
      expect(idMapping!['transform']).toBeDefined()
      expect(idMapping!['sink']).toBeDefined()
      expect(idMapping!['external']).toBeUndefined()
    })

    it('remaps internal input_ids within the duplicated subtree', () => {
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('source')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      const newTransform = blocks[idMapping!['transform']]
      const newSink = blocks[idMapping!['sink']]
      // transform's input should point to the NEW source copy
      expect(newTransform.input_ids['input']).toBe(idMapping!['source'])
      // sink's input should point to the NEW transform copy
      expect(newSink.input_ids['dataset']).toBe(idMapping!['transform'])
    })

    it('preserves external references (not in subtree)', () => {
      // Add a block that references both a subtree block and an external block
      act(() =>
        useFableBuilderStore.getState().setFable({
          blocks: {
            ...pipelineFable.blocks,
            joiner: {
              factory_id: {
                plugin: { store: 'ecmwf', local: 'test' },
                factory: 'join',
              },
              configuration_values: {},
              input_ids: { a: 'source', b: 'external' },
            },
          },
        }),
      )
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('source')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      const newJoiner = blocks[idMapping!['joiner']]
      // 'a' should be remapped, 'b' should keep original 'external'
      expect(newJoiner.input_ids['a']).toBe(idMapping!['source'])
      expect(newJoiner.input_ids['b']).toBe('external')
    })

    it('preserves configuration_values in duplicated blocks', () => {
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('source')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(blocks[idMapping!['source']].configuration_values).toEqual({
        model: 'aifs',
      })
      expect(blocks[idMapping!['transform']].configuration_values).toEqual({
        op: 'regrid',
      })
      expect(blocks[idMapping!['sink']].configuration_values).toEqual({
        path: '/out',
      })
    })

    it('selects the root duplicated block', () => {
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('source')
      })
      expect(useFableBuilderStore.getState().selectedBlockId).toBe(
        idMapping!['source'],
      )
    })

    it('marks as dirty', () => {
      act(() =>
        useFableBuilderStore.getState().duplicateBlockWithChildren('source'),
      )
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })

    it('does not modify original blocks', () => {
      act(() =>
        useFableBuilderStore.getState().duplicateBlockWithChildren('source'),
      )
      const blocks = useFableBuilderStore.getState().fable.blocks
      expect(blocks['source']).toEqual(pipelineFable.blocks['source'])
      expect(blocks['transform']).toEqual(pipelineFable.blocks['transform'])
      expect(blocks['sink']).toEqual(pipelineFable.blocks['sink'])
    })

    it('handles single block with no children', () => {
      let idMapping: Record<string, string> | undefined
      act(() => {
        idMapping = useFableBuilderStore
          .getState()
          .duplicateBlockWithChildren('external')
      })
      const blocks = useFableBuilderStore.getState().fable.blocks
      // Original 4 + 1 duplicated
      expect(Object.keys(blocks)).toHaveLength(5)
      expect(Object.keys(idMapping!)).toHaveLength(1)
      expect(idMapping!['external']).toBeDefined()
    })
  })

  describe('updateBlockConfig', () => {
    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
    })

    it('updates block configuration value', () => {
      act(() =>
        useFableBuilderStore
          .getState()
          .updateBlockConfig('block-1', 'param1', 'new_value'),
      )
      expect(
        useFableBuilderStore.getState().fable.blocks['block-1']
          .configuration_values.param1,
      ).toBe('new_value')
    })

    it('marks as dirty', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable)) // Reset dirty
      act(() =>
        useFableBuilderStore
          .getState()
          .updateBlockConfig('block-1', 'param1', 'new_value'),
      )
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('connectBlocks', () => {
    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
    })

    it('connects blocks', () => {
      act(() =>
        useFableBuilderStore
          .getState()
          .connectBlocks('block-2', 'new_input', 'block-1'),
      )
      expect(
        useFableBuilderStore.getState().fable.blocks['block-2'].input_ids
          .new_input,
      ).toBe('block-1')
    })
  })

  describe('disconnectBlock', () => {
    beforeEach(() => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
    })

    it('disconnects input', () => {
      act(() =>
        useFableBuilderStore.getState().disconnectBlock('block-2', 'input'),
      )
      expect(
        useFableBuilderStore.getState().fable.blocks['block-2'].input_ids.input,
      ).toBeUndefined()
    })
  })

  describe('selectBlock', () => {
    it('selects block', () => {
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      expect(useFableBuilderStore.getState().selectedBlockId).toBe('block-1')
    })

    it('opens config panel when selecting', () => {
      act(() => useFableBuilderStore.getState().setConfigPanelOpen(false))
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      expect(useFableBuilderStore.getState().isConfigPanelOpen).toBe(true)
    })

    it('closes config panel when deselecting', () => {
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      act(() => useFableBuilderStore.getState().selectBlock(null))
      expect(useFableBuilderStore.getState().isConfigPanelOpen).toBe(false)
    })
  })

  describe('mode controls', () => {
    it('sets mode', () => {
      act(() => useFableBuilderStore.getState().setMode('form'))
      expect(useFableBuilderStore.getState().mode).toBe('form')
    })

    it('sets step', () => {
      act(() => useFableBuilderStore.getState().setStep('review'))
      expect(useFableBuilderStore.getState().step).toBe('review')
    })

    it('toggles palette', () => {
      const initial = useFableBuilderStore.getState().isPaletteOpen
      act(() => useFableBuilderStore.getState().togglePalette())
      expect(useFableBuilderStore.getState().isPaletteOpen).toBe(!initial)
    })

    it('toggles config panel', () => {
      const initial = useFableBuilderStore.getState().isConfigPanelOpen
      act(() => useFableBuilderStore.getState().toggleConfigPanel())
      expect(useFableBuilderStore.getState().isConfigPanelOpen).toBe(!initial)
    })
  })

  describe('validation', () => {
    it('sets validation state', () => {
      const validationState = {
        isValid: false,
        globalErrors: ['Missing required block'],
        blockStates: {},
        possibleSources: [],
      }
      act(() =>
        useFableBuilderStore.getState().setValidationState(validationState),
      )
      expect(useFableBuilderStore.getState().validationState).toEqual(
        validationState,
      )
    })

    it('sets lastValidatedAt when setting validation state', () => {
      const before = Date.now()
      act(() =>
        useFableBuilderStore.getState().setValidationState({
          isValid: true,
          globalErrors: [],
          blockStates: {},
          possibleSources: [],
        }),
      )
      const after = Date.now()
      const lastValidatedAt = useFableBuilderStore.getState().lastValidatedAt
      expect(lastValidatedAt).toBeGreaterThanOrEqual(before)
      expect(lastValidatedAt).toBeLessThanOrEqual(after)
    })

    it('sets isValidating', () => {
      act(() => useFableBuilderStore.getState().setIsValidating(true))
      expect(useFableBuilderStore.getState().isValidating).toBe(true)
    })
  })

  describe('save state', () => {
    it('markSaved sets fableId and isDirty', () => {
      act(() => useFableBuilderStore.getState().markDirty())
      act(() => useFableBuilderStore.getState().markSaved('saved-id-123'))
      expect(useFableBuilderStore.getState().fableId).toBe('saved-id-123')
      expect(useFableBuilderStore.getState().isDirty).toBe(false)
    })

    it('markDirty sets isDirty', () => {
      act(() => useFableBuilderStore.getState().markDirty())
      expect(useFableBuilderStore.getState().isDirty).toBe(true)
    })
  })

  describe('reset', () => {
    it('resets to initial state', () => {
      act(() =>
        useFableBuilderStore.getState().setFable(mockFable, 'fable-123'),
      )
      act(() => useFableBuilderStore.getState().setMode('form'))
      act(() => useFableBuilderStore.getState().reset())

      const state = useFableBuilderStore.getState()
      expect(state.fable).toEqual(createEmptyFable())
      expect(state.fableId).toBeNull()
      expect(state.mode).toBe('graph')
      expect(state.isDirty).toBe(false)
    })
  })
})

describe('selector hooks', () => {
  beforeEach(() => {
    act(() => useFableBuilderStore.getState().reset())
  })

  describe('useBlockCount', () => {
    it('returns 0 for empty fable', () => {
      const { result } = renderHook(() => useBlockCount())
      expect(result.current).toBe(0)
    })

    it('returns correct count', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      const { result } = renderHook(() => useBlockCount())
      expect(result.current).toBe(2)
    })
  })

  describe('useHasBlocks', () => {
    it('returns false for empty fable', () => {
      const { result } = renderHook(() => useHasBlocks())
      expect(result.current).toBe(false)
    })

    it('returns true when blocks exist', () => {
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      const { result } = renderHook(() => useHasBlocks())
      expect(result.current).toBe(true)
    })
  })

  describe('useIsValid', () => {
    it('returns false when no validation state', () => {
      const { result } = renderHook(() => useIsValid())
      expect(result.current).toBe(false)
    })

    it('returns true when valid', () => {
      act(() =>
        useFableBuilderStore.getState().setValidationState({
          isValid: true,
          globalErrors: [],
          blockStates: {},
          possibleSources: [],
        }),
      )
      const { result } = renderHook(() => useIsValid())
      expect(result.current).toBe(true)
    })

    it('returns false when invalid', () => {
      act(() =>
        useFableBuilderStore.getState().setValidationState({
          isValid: false,
          globalErrors: ['Error'],
          blockStates: {},
          possibleSources: [],
        }),
      )
      const { result } = renderHook(() => useIsValid())
      expect(result.current).toBe(false)
    })
  })
})
