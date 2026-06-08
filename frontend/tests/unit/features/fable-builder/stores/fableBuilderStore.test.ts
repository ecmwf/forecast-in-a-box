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
import type {
  BlockFactory,
  FableBuilderV1,
  FableValidationState,
} from '@/api/types/fable.types'
import {
  useFableBuilderStore,
  useHasBlocks,
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

function makeValidationState(
  blockStates: FableValidationState['blockStates'] = {},
): FableValidationState {
  return {
    isValid: true,
    globalErrors: [],
    blockStates,
    possibleSources: [],
    resolvedConfigurationOptions: {},
  }
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

    it('has an empty default fableName', () => {
      // Blank by default; the UI renders a translated placeholder instead.
      expect(useFableBuilderStore.getState().fableName).toBe('')
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
          resolvedConfigurationOptions: {},
        }),
      )
      act(() => useFableBuilderStore.getState().setFable(mockFable))
      expect(useFableBuilderStore.getState().validationState).toBeNull()
    })

    it('resets isDirty to false', () => {
      act(() => useFableBuilderStore.setState({ isDirty: true }))
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

    it('seeds configuration_values from default_value when provided', () => {
      const factoryWithDefaults: BlockFactory = {
        ...mockFactory,
        configuration_options: {
          withDefault: {
            title: 'With Default',
            description: 'Has a default',
            value_type: 'int',
            default_value: '42',
          },
          noDefault: {
            title: 'No Default',
            description: 'No default provided',
            value_type: 'str',
          },
          nullDefault: {
            title: 'Null Default',
            description: 'Explicit null default',
            value_type: 'str',
            default_value: null,
          },
        },
      }

      let blockId = ''
      act(() => {
        blockId = useFableBuilderStore
          .getState()
          .addBlock(
            { plugin: { store: 'ecmwf', local: 'test' }, factory: 'source' },
            factoryWithDefaults,
          )
      })

      const instance = useFableBuilderStore.getState().fable.blocks[blockId]
      expect(instance.configuration_values).toEqual({
        withDefault: '42',
        noDefault: '',
        nullDefault: '',
      })
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

    it('replaces stale restrictions when reconnecting to an unrestricted source', () => {
      const fable: FableBuilderV1 = {
        blocks: {
          restricted: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'test' },
              factory: 'source',
            },
            configuration_values: {},
            input_ids: {},
          },
          unrestricted: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'test' },
              factory: 'source',
            },
            configuration_values: {},
            input_ids: {},
          },
          target: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'test' },
              factory: 'transform',
            },
            configuration_values: {},
            input_ids: {},
          },
        },
      }

      act(() => useFableBuilderStore.getState().setFable(fable))
      act(() =>
        useFableBuilderStore.getState().setValidationState(
          makeValidationState({
            restricted: {
              errors: [],
              hasErrors: false,
              possibleExpansions: [],
              possibleExpansionRestrictions: {
                'ecmwf/test:transform': {
                  param: 'list[enumClosed[2t,msl]]',
                },
              },
              configurationRestrictions: {},
              missingGlyphs: {},
            },
            unrestricted: {
              errors: [],
              hasErrors: false,
              possibleExpansions: [],
              possibleExpansionRestrictions: {},
              configurationRestrictions: {},
              missingGlyphs: {},
            },
          }),
        ),
      )
      act(() =>
        useFableBuilderStore
          .getState()
          .connectBlocks('target', 'input', 'restricted'),
      )
      expect(
        useFableBuilderStore.getState().blockConfigurationRestrictions.target,
      ).toEqual({ param: 'list[enumClosed[2t,msl]]' })

      act(() =>
        useFableBuilderStore.getState().setValidationState(
          makeValidationState({
            unrestricted: {
              errors: [],
              hasErrors: false,
              possibleExpansions: [],
              possibleExpansionRestrictions: {},
              configurationRestrictions: {},
              missingGlyphs: {},
            },
          }),
        ),
      )
      act(() =>
        useFableBuilderStore
          .getState()
          .connectBlocks('target', 'input', 'unrestricted'),
      )

      expect(
        useFableBuilderStore.getState().blockConfigurationRestrictions.target,
      ).toBeUndefined()
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

    it('keeps config panel open when deselecting (Blender pattern)', () => {
      act(() => useFableBuilderStore.getState().selectBlock('block-1'))
      act(() => useFableBuilderStore.getState().selectBlock(null))
      // Sidebar stays visible with placeholder — user closes explicitly
      expect(useFableBuilderStore.getState().isConfigPanelOpen).toBe(true)
      expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
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
      const validationState = makeValidationState()
      validationState.isValid = false
      validationState.globalErrors = ['Missing required block']
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
        useFableBuilderStore
          .getState()
          .setValidationState(makeValidationState()),
      )
      const after = Date.now()
      const lastValidatedAt = useFableBuilderStore.getState().lastValidatedAt
      expect(lastValidatedAt).toBeGreaterThanOrEqual(before)
      expect(lastValidatedAt).toBeLessThanOrEqual(after)
    })

    it('clears pending configuration restrictions when fresh validation arrives', () => {
      act(() =>
        useFableBuilderStore
          .getState()
          .setBlockConfigurationRestrictions('block-2', {
            param: 'list[enumClosed[2t,msl]]',
          }),
      )

      act(() =>
        useFableBuilderStore
          .getState()
          .setValidationState(makeValidationState()),
      )

      expect(
        useFableBuilderStore.getState().blockConfigurationRestrictions,
      ).toEqual({})
    })

    it('sets isValidating', () => {
      act(() => useFableBuilderStore.getState().setIsValidating(true))
      expect(useFableBuilderStore.getState().isValidating).toBe(true)
    })
  })

  describe('save state', () => {
    it('markSaved sets fableId, fableVersion, and isDirty', () => {
      act(() => useFableBuilderStore.setState({ isDirty: true }))
      act(() => useFableBuilderStore.getState().markSaved('saved-id-123', 1))
      expect(useFableBuilderStore.getState().fableId).toBe('saved-id-123')
      expect(useFableBuilderStore.getState().fableVersion).toBe(1)
      expect(useFableBuilderStore.getState().isDirty).toBe(false)
    })

    it('markSubmitted clears isDirty and bumps lastSavedAt without touching fableId/version', () => {
      act(() =>
        useFableBuilderStore.getState().setFable(mockFable, 'loaded-id-7'),
      )
      act(() =>
        useFableBuilderStore.setState({ fableVersion: 3, isDirty: true }),
      )

      const before = useFableBuilderStore.getState().lastSavedAt
      act(() => useFableBuilderStore.getState().markSubmitted())
      const after = useFableBuilderStore.getState()

      expect(after.isDirty).toBe(false)
      expect(after.lastSavedAt).not.toBe(before)
      expect(after.fableId).toBe('loaded-id-7')
      expect(after.fableVersion).toBe(3)
      expect(after.fable).toEqual(mockFable)
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

describe('undo/redo', () => {
  beforeEach(() => {
    act(() => useFableBuilderStore.getState().reset())
  })

  const factoryId = {
    plugin: { store: 'ecmwf', local: 'test' },
    factory: 'source',
  }

  it('starts with empty history', () => {
    const s = useFableBuilderStore.getState()
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
  })

  it('undo restores the pre-mutation fable', () => {
    const before = useFableBuilderStore.getState().fable
    act(() => {
      useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    act(() => useFableBuilderStore.getState().undo())
    expect(useFableBuilderStore.getState().fable).toEqual(before)
  })

  it('redo replays the undone mutation', () => {
    let added = ''
    act(() => {
      added = useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    const afterAdd = useFableBuilderStore.getState().fable
    act(() => useFableBuilderStore.getState().undo())
    act(() => useFableBuilderStore.getState().redo())
    expect(useFableBuilderStore.getState().fable).toEqual(afterAdd)
    expect(useFableBuilderStore.getState().fable.blocks[added]).toBeDefined()
  })

  it('clears future on a fresh edit after undo', () => {
    act(() => {
      useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    act(() => useFableBuilderStore.getState().undo())
    expect(useFableBuilderStore.getState().future.length).toBe(1)
    act(() => {
      useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    expect(useFableBuilderStore.getState().future).toEqual([])
  })

  it('coalesces same-key config edits into a single undo step', () => {
    let blockId = ''
    act(() => {
      blockId = useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    // The addBlock push leaves past.length === 1. Subsequent same-key typing
    // should not grow past — it collapses into the original snapshot.
    const pastAfterAdd = useFableBuilderStore.getState().past.length
    act(() => {
      useFableBuilderStore.getState().updateBlockConfig(blockId, 'param1', 'a')
    })
    act(() => {
      useFableBuilderStore.getState().updateBlockConfig(blockId, 'param1', 'ab')
    })
    act(() => {
      useFableBuilderStore
        .getState()
        .updateBlockConfig(blockId, 'param1', 'abc')
    })
    // First typing keystroke pushes once; the next two coalesce.
    expect(useFableBuilderStore.getState().past.length).toBe(pastAfterAdd + 1)
    // Undoing returns to the empty-value state (the snapshot taken before
    // the first keystroke), not to the in-between values.
    act(() => useFableBuilderStore.getState().undo())
    expect(
      useFableBuilderStore.getState().fable.blocks[blockId].configuration_values
        .param1,
    ).toBe('')
  })

  it('does not coalesce edits to different keys', () => {
    let blockId = ''
    act(() => {
      blockId = useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    const base = useFableBuilderStore.getState().past.length
    act(() => {
      useFableBuilderStore.getState().updateBlockConfig(blockId, 'param1', 'x')
    })
    act(() => {
      useFableBuilderStore.getState().updateBlockConfig(blockId, 'param2', 'y')
    })
    // Different coalesce keys → both push.
    expect(useFableBuilderStore.getState().past.length).toBe(base + 2)
  })

  it('bounds the history at MAX_HISTORY entries', () => {
    // MAX_HISTORY is 100 in the store; push 120 distinct edits and confirm
    // the stack stays capped while preserving the most recent snapshots.
    for (let i = 0; i < 120; i++) {
      act(() => {
        useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
      })
    }
    expect(useFableBuilderStore.getState().past.length).toBe(100)
  })

  it('setFable clears the entire history', () => {
    act(() => {
      useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    act(() => useFableBuilderStore.getState().undo())
    expect(useFableBuilderStore.getState().future.length).toBe(1)
    act(() => useFableBuilderStore.getState().setFable(mockFable))
    expect(useFableBuilderStore.getState().past).toEqual([])
    expect(useFableBuilderStore.getState().future).toEqual([])
  })

  it('undo with an empty past is a no-op', () => {
    const before = useFableBuilderStore.getState().fable
    act(() => useFableBuilderStore.getState().undo())
    expect(useFableBuilderStore.getState().fable).toBe(before)
  })

  it('redo with an empty future is a no-op', () => {
    act(() => {
      useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    const after = useFableBuilderStore.getState().fable
    act(() => useFableBuilderStore.getState().redo())
    expect(useFableBuilderStore.getState().fable).toBe(after)
  })

  it('history transactions collapse a multi-action UI flow to one undo step', () => {
    let blockId = ''
    // Mirror what a drag-drop or popover-add does: add + connect inside one
    // transaction. Both pushHistory calls coalesce; only one snapshot lands.
    act(() => {
      useFableBuilderStore.getState().beginHistoryTransaction()
      blockId = useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
      useFableBuilderStore.getState().connectBlocks(blockId, 'in', blockId)
      useFableBuilderStore.getState().endHistoryTransaction()
    })
    expect(useFableBuilderStore.getState().past.length).toBe(1)
    act(() => useFableBuilderStore.getState().undo())
    // One undo wipes the whole transaction — no orphaned node, no stray edges.
    expect(
      useFableBuilderStore.getState().fable.blocks[blockId],
    ).toBeUndefined()
  })

  it('clears selectedBlockId on undo when the selected block disappears', () => {
    let blockId = ''
    act(() => {
      blockId = useFableBuilderStore.getState().addBlock(factoryId, mockFactory)
    })
    expect(useFableBuilderStore.getState().selectedBlockId).toBe(blockId)
    act(() => useFableBuilderStore.getState().undo())
    expect(useFableBuilderStore.getState().selectedBlockId).toBeNull()
  })
})

describe('selector hooks', () => {
  beforeEach(() => {
    act(() => useFableBuilderStore.getState().reset())
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
})
