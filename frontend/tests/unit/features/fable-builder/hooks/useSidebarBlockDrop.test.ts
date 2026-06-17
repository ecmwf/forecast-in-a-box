/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import type {
  BlockFactory,
  BlockInstance,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { DropConnection } from '@/features/fable-builder/hooks/useSidebarBlockDrop'
import {
  computeSpliceContext,
  dropModeForConnection,
} from '@/features/fable-builder/hooks/useSidebarBlockDrop'

function makeFactory(
  kind: BlockFactory['kind'],
  inputs: ReadonlyArray<string> = [],
): BlockFactory {
  return {
    kind,
    title: 't',
    description: 'd',
    configuration_options: {},
    inputs: [...inputs],
  }
}

function makeBlock(
  factoryName: string,
  input_ids: Record<string, string> = {},
): BlockInstance {
  return {
    factory_id: {
      plugin: { store: 'ecmwf', local: 'base' },
      factory: factoryName,
    },
    configuration_values: {},
    input_ids,
  }
}

function makeFable(blocks: Record<string, BlockInstance>): FableBuilderV1 {
  return { blocks }
}

function outputConn(nodeId: string): DropConnection {
  return { nodeId, handleId: 'output', isInput: false, handleEl: null }
}

function inputConn(nodeId: string, handleId: string): DropConnection {
  return { nodeId, handleId, isInput: true, handleEl: null }
}

describe('computeSpliceContext', () => {
  describe("output drop (drop on a block's output handle)", () => {
    it('collects downstream consumers when dragging a transform → splice', () => {
      // Source → MapPlot. Drop a transform on Source's output.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        sink: makeBlock('mapPlotSink', { dataset: 'source' }),
      })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(outputConn('source'), transform, fable)

      expect(ctx.downstream).toEqual([{ id: 'sink', inputName: 'dataset' }])
      expect(ctx.priorParent).toBeNull()
    })

    it('skips downstream collection when dragging a sink → sibling, not splice', () => {
      // Regression: dropping a second MapPlot on Source's output used to
      // splice through the new sink (no output → existing consumer orphaned).
      // It should now create a sibling instead.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        sink: makeBlock('mapPlotSink', { dataset: 'source' }),
      })
      const sink = makeFactory('sink', ['dataset'])

      const ctx = computeSpliceContext(outputConn('source'), sink, fable)

      expect(ctx.downstream).toEqual([])
      expect(ctx.priorParent).toBeNull()
    })

    it('collects every consumer when the source has multiple downstream blocks', () => {
      // Source → sink1, Source → sink2. Splice should rewire both.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        sink1: makeBlock('mapPlotSink', { dataset: 'source' }),
        sink2: makeBlock('mapPlotSink', { dataset: 'source' }),
      })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(outputConn('source'), transform, fable)

      expect(ctx.downstream).toHaveLength(2)
      expect(ctx.downstream).toContainEqual({
        id: 'sink1',
        inputName: 'dataset',
      })
      expect(ctx.downstream).toContainEqual({
        id: 'sink2',
        inputName: 'dataset',
      })
    })

    it('collects each input separately when one consumer reads via multiple inputs', () => {
      // Diff reads from `source` via both `left` and `right`. Splicing the
      // edge means each input gets rewired through the new block independently.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        diff: makeBlock('diff', { left: 'source', right: 'source' }),
      })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(outputConn('source'), transform, fable)

      expect(ctx.downstream).toHaveLength(2)
      expect(ctx.downstream).toContainEqual({ id: 'diff', inputName: 'left' })
      expect(ctx.downstream).toContainEqual({ id: 'diff', inputName: 'right' })
    })

    it('returns empty downstream when the source has no existing consumers', () => {
      const fable = makeFable({ source: makeBlock('anemoiSource') })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(outputConn('source'), transform, fable)

      expect(ctx.downstream).toEqual([])
      expect(ctx.priorParent).toBeNull()
    })

    it('skips downstream collection for a 0-input dragged factory', () => {
      // Sources have no inputs — they can\'t be spliced into an edge.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        sink: makeBlock('mapPlotSink', { dataset: 'source' }),
      })
      const sourceFactory = makeFactory('source', [])

      const ctx = computeSpliceContext(
        outputConn('source'),
        sourceFactory,
        fable,
      )

      expect(ctx.downstream).toEqual([])
      expect(ctx.priorParent).toBeNull()
    })
  })

  describe("input drop (drop on a block's input handle)", () => {
    it('captures priorParent when the input is already wired', () => {
      // Source → Sink (via `dataset`). Drop a transform on Sink's `dataset`
      // input → existing Source becomes the new block\'s upstream.
      const fable = makeFable({
        source: makeBlock('anemoiSource'),
        sink: makeBlock('mapPlotSink', { dataset: 'source' }),
      })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(
        inputConn('sink', 'dataset'),
        transform,
        fable,
      )

      expect(ctx.priorParent).toBe('source')
      expect(ctx.downstream).toEqual([])
    })

    it('returns null priorParent when the input is empty', () => {
      const fable = makeFable({ sink: makeBlock('mapPlotSink') })
      const transform = makeFactory('product', ['data'])

      const ctx = computeSpliceContext(
        inputConn('sink', 'dataset'),
        transform,
        fable,
      )

      expect(ctx.priorParent).toBeNull()
      expect(ctx.downstream).toEqual([])
    })
  })
})

describe('dropModeForConnection', () => {
  it('output drop on a source with consumers → branch', () => {
    const fable = makeFable({
      source: makeBlock('anemoiSource'),
      sink: makeBlock('mapPlotSink', { dataset: 'source' }),
    })
    expect(dropModeForConnection(outputConn('source'), fable)).toBe('branch')
  })

  it('output drop on a source with no consumers → connect', () => {
    const fable = makeFable({ source: makeBlock('anemoiSource') })
    expect(dropModeForConnection(outputConn('source'), fable)).toBe('connect')
  })

  it('input drop on an already-wired input → insert', () => {
    const fable = makeFable({
      source: makeBlock('anemoiSource'),
      sink: makeBlock('mapPlotSink', { dataset: 'source' }),
    })
    expect(dropModeForConnection(inputConn('sink', 'dataset'), fable)).toBe(
      'insert',
    )
  })

  it('input drop on an empty input → connect', () => {
    const fable = makeFable({ sink: makeBlock('mapPlotSink') })
    expect(dropModeForConnection(inputConn('sink', 'dataset'), fable)).toBe(
      'connect',
    )
  })
})
