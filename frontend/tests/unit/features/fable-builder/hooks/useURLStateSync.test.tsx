/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { useURLStateSync } from '@/features/fable-builder/hooks/useURLStateSync'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

// Mock url-state utilities
const mockEncodeFableToURL = vi.fn()
const mockDecodeFableFromURL = vi.fn()
const mockIsStateTooLarge = vi.fn()
vi.mock('@/features/fable-builder/utils/url-state', () => ({
  encodeFableToURL: (fable: FableBuilderV1) => mockEncodeFableToURL(fable),
  decodeFableFromURL: (encoded: string) => mockDecodeFableFromURL(encoded),
  isStateTooLarge: (encoded: string) => mockIsStateTooLarge(encoded),
}))

describe('useURLStateSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store
    useFableBuilderStore.setState({
      fable: { blocks: {} },
    })
    // Default mock implementations
    mockEncodeFableToURL.mockReturnValue('encoded-state')
    mockDecodeFableFromURL.mockReturnValue(null)
    mockIsStateTooLarge.mockReturnValue(false)
  })

  afterEach(() => {
    useFableBuilderStore.getState().reset()
  })

  function TestComponent({
    encodedState,
    enabled = true,
    onResult,
  }: {
    encodedState?: string
    enabled?: boolean
    onResult?: (result: { loadedFromURL: boolean }) => void
  }) {
    const result = useURLStateSync({ encodedState, enabled })
    if (onResult) {
      onResult(result)
    }
    return (
      <div data-testid="result">
        {result.loadedFromURL ? 'loaded' : 'not-loaded'}
      </div>
    )
  }

  describe('initialization', () => {
    it('returns loadedFromURL false when no encodedState provided', async () => {
      let capturedResult: { loadedFromURL: boolean } | null = null

      await render(
        <TestComponent
          onResult={(result) => {
            capturedResult = result
          }}
        />,
      )

      expect(capturedResult!.loadedFromURL).toBe(false)
    })

    it('returns loadedFromURL true when encodedState is provided', async () => {
      let capturedResult: { loadedFromURL: boolean } | null = null

      await render(
        <TestComponent
          encodedState="some-encoded-state"
          onResult={(result) => {
            capturedResult = result
          }}
        />,
      )

      expect(capturedResult!.loadedFromURL).toBe(true)
    })

    it('decodes and sets fable from URL on mount', async () => {
      const decodedFable: FableBuilderV1 = {
        blocks: {
          block1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'test' },
              factory: 'test',
            },
            configuration_values: { key: 'value' },
            input_ids: {},
          },
        },
      }
      mockDecodeFableFromURL.mockReturnValue(decodedFable)

      await render(<TestComponent encodedState="encoded-fable-state" />)

      expect(mockDecodeFableFromURL).toHaveBeenCalledWith('encoded-fable-state')
      expect(useFableBuilderStore.getState().fable).toEqual(decodedFable)
    })

    it('does not decode when disabled', async () => {
      await render(
        <TestComponent encodedState="encoded-state" enabled={false} />,
      )

      expect(mockDecodeFableFromURL).not.toHaveBeenCalled()
    })

    it('handles invalid encoded state gracefully', async () => {
      mockDecodeFableFromURL.mockReturnValue(null)

      await render(<TestComponent encodedState="invalid-state" />)

      expect(mockDecodeFableFromURL).toHaveBeenCalledWith('invalid-state')
      // Store should remain unchanged (empty blocks)
      expect(useFableBuilderStore.getState().fable).toEqual({ blocks: {} })
    })
  })

  describe('URL updates', () => {
    // Note: Tests that require fake timers are skipped in browser mode
    // as vi.useFakeTimers() doesn't work well with async component updates

    it('does not update URL when fable is empty on mount', async () => {
      await render(<TestComponent />)

      // Wait a bit for any potential updates
      await new Promise((resolve) => setTimeout(resolve, 400))

      // Navigate should not be called for empty fable
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('does not update URL when disabled', async () => {
      await render(<TestComponent enabled={false} />)

      useFableBuilderStore.setState({
        fable: {
          blocks: {
            block1: {
              factory_id: {
                plugin: { store: 'ecmwf', local: 'p' },
                factory: 'f',
              },
              configuration_values: {},
              input_ids: {},
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 400))

      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('calls encodeFableToURL when fable changes', async () => {
      await render(<TestComponent />)

      const newFable = {
        blocks: {
          block1: {
            factory_id: {
              plugin: { store: 'ecmwf', local: 'p' },
              factory: 'f',
            },
            configuration_values: {},
            input_ids: {},
          },
        },
      }

      useFableBuilderStore.setState({ fable: newFable })

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 400))

      expect(mockEncodeFableToURL).toHaveBeenCalled()
    })
  })

  describe('large state detection', () => {
    it('calls isStateTooLarge with encoded state', async () => {
      mockEncodeFableToURL.mockReturnValue('test-encoded')

      await render(<TestComponent />)

      useFableBuilderStore.setState({
        fable: {
          blocks: {
            block1: {
              factory_id: {
                plugin: { store: 'ecmwf', local: 'p' },
                factory: 'f',
              },
              configuration_values: {},
              input_ids: {},
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 400))

      expect(mockIsStateTooLarge).toHaveBeenCalledWith('test-encoded')
    })
  })
})
