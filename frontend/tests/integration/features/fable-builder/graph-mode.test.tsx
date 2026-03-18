/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { mockCatalogue } from '../../../../mocks/data/fable.data'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  fableToEdges,
  fableToGraph,
  fableToNodes,
} from '@/features/fable-builder/utils/fable-to-graph'
import {
  layoutNodes,
  needsLayout,
} from '@/features/fable-builder/utils/layout-blocks'

// Mock useMedia to simulate desktop layout (three-column with sidebars)
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Mock useURLStateSync to prevent navigation to /configure
vi.mock('@/features/fable-builder/hooks/useURLStateSync', () => ({
  useURLStateSync: () => ({ loadedFromURL: false }),
}))

// Mock auth hooks used by EditStep
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ authType: 'anonymous', isAuthenticated: true }),
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ data: { is_superuser: true } }),
}))

/**
 * Creates a multi-block fable with source -> product -> sink pipeline
 * for testing the graph visualization utilities.
 */
function createMultiBlockFable(): FableBuilderV1 {
  return {
    blocks: {
      source1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'ekdSource',
        },
        configuration_values: {
          source: 'mars',
          date: '2026-01-01',
          expver: '0001',
        },
        input_ids: {},
      },
      product1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'ensembleStatistics',
        },
        configuration_values: {
          variable: '2t',
          statistic: 'mean',
        },
        input_ids: { dataset: 'source1' },
      },
      sink1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'zarrSink',
        },
        configuration_values: { path: '/tmp/output.zarr' },
        input_ids: { dataset: 'product1' },
      },
    },
  }
}

/**
 * Creates a simple fable with just a source block (no downstream connections).
 */
function createSourceOnlyFable(): FableBuilderV1 {
  return {
    blocks: {
      source1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'ekdSource',
        },
        configuration_values: {
          source: 'mars',
          date: '2026-01-01',
          expver: '0001',
        },
        input_ids: {},
      },
    },
  }
}

describe('Graph Mode - Utility Functions', () => {
  describe('fableToNodes', () => {
    it('converts fable blocks to ReactFlow nodes', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)

      expect(nodes).toHaveLength(3)

      const nodeIds = nodes.map((n) => n.id)
      expect(nodeIds).toContain('source1')
      expect(nodeIds).toContain('product1')
      expect(nodeIds).toContain('sink1')
    })

    it('assigns correct node types based on factory kind', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)

      const sourceNode = nodes.find((n) => n.id === 'source1')
      const productNode = nodes.find((n) => n.id === 'product1')
      const sinkNode = nodes.find((n) => n.id === 'sink1')

      expect(sourceNode?.type).toBe('sourceBlock')
      expect(productNode?.type).toBe('productBlock')
      expect(sinkNode?.type).toBe('sinkBlock')
    })

    it('includes factory data in node data', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)

      const sourceNode = nodes.find((n) => n.id === 'source1')
      expect(sourceNode?.data.label).toBe('Earthkit Data Source')
      expect(sourceNode?.data.instanceId).toBe('source1')
      expect(sourceNode?.data.factory.kind).toBe('source')
    })

    it('returns empty array for empty fable', () => {
      const fable: FableBuilderV1 = { blocks: {} }
      const nodes = fableToNodes(fable, mockCatalogue)

      expect(nodes).toHaveLength(0)
    })

    it('skips blocks with unknown factory IDs', () => {
      const fable: FableBuilderV1 = {
        blocks: {
          unknown1: {
            factory_id: {
              plugin: { store: 'nonexistent', local: 'plugin' },
              factory: 'missing',
            },
            configuration_values: {},
            input_ids: {},
          },
        },
      }
      const nodes = fableToNodes(fable, mockCatalogue)

      expect(nodes).toHaveLength(0)
    })
  })

  describe('fableToEdges', () => {
    it('creates edges from input_ids relationships', () => {
      const fable = createMultiBlockFable()
      const edges = fableToEdges(fable, mockCatalogue)

      expect(edges).toHaveLength(2)

      // source1 -> product1 (via dataset input)
      const sourceToProduct = edges.find(
        (e) => e.source === 'source1' && e.target === 'product1',
      )
      expect(sourceToProduct).toBeDefined()
      expect(sourceToProduct?.data?.inputName).toBe('dataset')

      // product1 -> sink1 (via dataset input)
      const productToSink = edges.find(
        (e) => e.source === 'product1' && e.target === 'sink1',
      )
      expect(productToSink).toBeDefined()
      expect(productToSink?.data?.inputName).toBe('dataset')
    })

    it('returns empty array for fable with no connections', () => {
      const fable = createSourceOnlyFable()
      const edges = fableToEdges(fable, mockCatalogue)

      expect(edges).toHaveLength(0)
    })

    it('skips empty input_ids entries', () => {
      const fable: FableBuilderV1 = {
        blocks: {
          block1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'ecmwf-base' },
              factory: 'zarrSink',
            },
            configuration_values: { path: '/tmp/out.zarr' },
            input_ids: { dataset: '' },
          },
        },
      }
      const edges = fableToEdges(fable, mockCatalogue)

      expect(edges).toHaveLength(0)
    })
  })

  describe('fableToGraph', () => {
    it('returns both nodes and edges', () => {
      const fable = createMultiBlockFable()
      const { nodes, edges } = fableToGraph(fable, mockCatalogue)

      expect(nodes).toHaveLength(3)
      expect(edges).toHaveLength(2)
    })
  })

  describe('needsLayout', () => {
    it('returns true when nodes have default positions (0, 0)', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)

      // fableToNodes sets all positions to (0, 0)
      expect(needsLayout(nodes)).toBe(true)
    })

    it('returns false when all nodes have non-zero positions', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue).map((node, i) => ({
        ...node,
        // Offset by 10 so even i=0 has a non-(0,0) position
        position: { x: 10 + i * 100, y: 10 + i * 50 },
      }))

      expect(needsLayout(nodes)).toBe(false)
    })

    it('returns true when any node has position (0, 0)', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue).map((node, i) => ({
        ...node,
        position:
          i === 0 ? { x: 0, y: 0 } : { x: 100 + i * 50, y: 50 + i * 25 },
      }))

      expect(needsLayout(nodes)).toBe(true)
    })
  })

  describe('layoutNodes', () => {
    it('assigns non-zero positions to nodes after layout', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)
      const edges = fableToEdges(fable, mockCatalogue)

      const laidOut = layoutNodes(nodes, edges)

      // After layout, nodes should NOT all be at (0,0)
      const allAtOrigin = laidOut.every(
        (n) => n.position.x === 0 && n.position.y === 0,
      )
      expect(allAtOrigin).toBe(false)
    })

    it('uses provided layout direction', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)
      const edges = fableToEdges(fable, mockCatalogue)

      const lrLayout = layoutNodes(nodes, edges, { direction: 'LR' })
      const tbLayout = layoutNodes(nodes, edges, { direction: 'TB' })

      // LR layout: nodes should spread more horizontally
      // TB layout: nodes should spread more vertically
      const lrXSpread =
        Math.max(...lrLayout.map((n) => n.position.x)) -
        Math.min(...lrLayout.map((n) => n.position.x))
      const tbXSpread =
        Math.max(...tbLayout.map((n) => n.position.x)) -
        Math.min(...tbLayout.map((n) => n.position.x))

      const lrYSpread =
        Math.max(...lrLayout.map((n) => n.position.y)) -
        Math.min(...lrLayout.map((n) => n.position.y))
      const tbYSpread =
        Math.max(...tbLayout.map((n) => n.position.y)) -
        Math.min(...tbLayout.map((n) => n.position.y))

      // LR should have larger X spread than TB, TB should have larger Y spread
      expect(lrXSpread).toBeGreaterThan(tbXSpread)
      expect(tbYSpread).toBeGreaterThan(lrYSpread)
    })

    it('handles single node without edges', () => {
      const fable = createSourceOnlyFable()
      const nodes = fableToNodes(fable, mockCatalogue)

      const laidOut = layoutNodes(nodes, [])

      expect(laidOut).toHaveLength(1)
      // Should still have a valid position
      expect(typeof laidOut[0].position.x).toBe('number')
      expect(typeof laidOut[0].position.y).toBe('number')
    })

    it('respects custom node dimensions', () => {
      const fable = createMultiBlockFable()
      const nodes = fableToNodes(fable, mockCatalogue)
      const edges = fableToEdges(fable, mockCatalogue)

      const smallLayout = layoutNodes(nodes, edges, {
        nodeWidth: 100,
        nodeHeight: 50,
      })
      const largeLayout = layoutNodes(nodes, edges, {
        nodeWidth: 400,
        nodeHeight: 300,
      })

      // Larger nodes should produce a more spread out layout
      const smallSpread =
        Math.max(...smallLayout.map((n) => n.position.x)) -
        Math.min(...smallLayout.map((n) => n.position.x))
      const largeSpread =
        Math.max(...largeLayout.map((n) => n.position.x)) -
        Math.min(...largeLayout.map((n) => n.position.x))

      // Large nodes should have at least as much spread
      expect(largeSpread).toBeGreaterThanOrEqual(smallSpread)
    })
  })
})

describe('Graph Mode - Builder Integration', () => {
  beforeEach(() => {
    useFableBuilderStore.getState().reset()
    vi.clearAllMocks()
  })

  it('shows config panel with block details when a block is selected in graph mode', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    // Wait for catalogue to load
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a fable and select a block
    const store = useFableBuilderStore.getState()
    store.setFable(createMultiBlockFable())
    store.selectBlock('source1')

    // In graph mode, the ConfigPanel sidebar shows the factory title
    await expect
      .element(screen.getByText('Earthkit Data Source').first())
      .toBeVisible()

    // Configuration fields should appear (use Expver, a text input, to avoid enum combobox)
    await expect.element(screen.getByLabelText('Expver')).toBeVisible()
  })

  it('shows "Select a block to configure" when no block is selected', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a fable but do NOT select a block
    const store = useFableBuilderStore.getState()
    store.setFable(createMultiBlockFable())

    // The config panel should show the placeholder
    await expect
      .element(screen.getByText('Select a block to configure'))
      .toBeVisible()
  })

  it('shows input connections section for blocks with inputs', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up fable and select the sink (which has an input connection)
    const store = useFableBuilderStore.getState()
    store.setFable(createMultiBlockFable())
    store.selectBlock('sink1')

    // Sink block has Input Connections section
    await expect.element(screen.getByText('Input Connections')).toBeVisible()

    // The input name "dataset" should appear as a label
    await expect.element(screen.getByLabelText('dataset')).toBeVisible()
  })

  it('updates block count in header as blocks are added', async () => {
    const screen = await renderWithRouter(<FableBuilderPage />)

    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    // Set up a 3-block fable
    const store = useFableBuilderStore.getState()
    store.setFable(createMultiBlockFable())

    // Block count should show "3 blocks"
    await expect.element(screen.getByText('3 blocks')).toBeVisible()
  })
})

describe('Graph Mode - Store State', () => {
  beforeEach(() => {
    useFableBuilderStore.getState().reset()
  })

  it('defaults to graph mode', () => {
    const state = useFableBuilderStore.getState()
    expect(state.mode).toBe('graph')
  })

  it('can switch between graph and form modes', () => {
    const store = useFableBuilderStore.getState()
    store.setMode('form')
    expect(useFableBuilderStore.getState().mode).toBe('form')

    useFableBuilderStore.getState().setMode('graph')
    expect(useFableBuilderStore.getState().mode).toBe('graph')
  })

  it('preserves layout direction preference', () => {
    const store = useFableBuilderStore.getState()
    store.setLayoutDirection('LR')
    expect(useFableBuilderStore.getState().layoutDirection).toBe('LR')

    useFableBuilderStore.getState().setLayoutDirection('TB')
    expect(useFableBuilderStore.getState().layoutDirection).toBe('TB')
  })

  it('supports toggling auto-layout', () => {
    const store = useFableBuilderStore.getState()
    expect(store.autoLayout).toBe(true) // default

    store.setAutoLayout(false)
    expect(useFableBuilderStore.getState().autoLayout).toBe(false)

    useFableBuilderStore.getState().setAutoLayout(true)
    expect(useFableBuilderStore.getState().autoLayout).toBe(true)
  })

  it('supports toggling nodes locked', () => {
    const store = useFableBuilderStore.getState()
    expect(store.nodesLocked).toBe(true) // default

    store.setNodesLocked(false)
    expect(useFableBuilderStore.getState().nodesLocked).toBe(false)
  })

  it('supports edge style changes', () => {
    const store = useFableBuilderStore.getState()
    store.setEdgeStyle('smoothstep')
    expect(useFableBuilderStore.getState().edgeStyle).toBe('smoothstep')

    useFableBuilderStore.getState().setEdgeStyle('step')
    expect(useFableBuilderStore.getState().edgeStyle).toBe('step')
  })

  it('increments fitViewTrigger when triggerFitView is called', () => {
    const store = useFableBuilderStore.getState()
    const initialTrigger = store.fitViewTrigger

    store.triggerFitView()
    expect(useFableBuilderStore.getState().fitViewTrigger).toBe(
      initialTrigger + 1,
    )

    useFableBuilderStore.getState().triggerFitView()
    expect(useFableBuilderStore.getState().fitViewTrigger).toBe(
      initialTrigger + 2,
    )
  })

  it('supports minimap toggle', () => {
    const store = useFableBuilderStore.getState()
    expect(store.isMiniMapOpen).toBe(true) // default

    store.toggleMiniMap()
    expect(useFableBuilderStore.getState().isMiniMapOpen).toBe(false)

    useFableBuilderStore.getState().toggleMiniMap()
    expect(useFableBuilderStore.getState().isMiniMapOpen).toBe(true)
  })
})
