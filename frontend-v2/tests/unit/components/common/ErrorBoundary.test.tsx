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
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

// Mock logger to suppress expected error output in tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Component that throws an error
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message')
  }
  return <div>Content rendered successfully</div>
}

describe('ErrorBoundary', () => {
  // Suppress console.error during error boundary tests
  const originalConsoleError = console.error
  beforeEach(() => {
    console.error = vi.fn()
  })
  afterEach(() => {
    console.error = originalConsoleError
  })

  describe('without error', () => {
    it('renders children when no error occurs', async () => {
      const screen = await render(
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>,
      )
      await expect.element(screen.getByText('Child content')).toBeVisible()
    })

    it('renders multiple children', async () => {
      const screen = await render(
        <ErrorBoundary>
          <span>First</span>
          <span>Second</span>
        </ErrorBoundary>,
      )
      await expect.element(screen.getByText('First')).toBeVisible()
      await expect.element(screen.getByText('Second')).toBeVisible()
    })
  })

  describe('with error', () => {
    it('renders default fallback when error occurs', async () => {
      const screen = await render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect
        .element(screen.getByText('Something went wrong'))
        .toBeVisible()
    })

    it('displays error message', async () => {
      const screen = await render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect.element(screen.getByText('Test error message')).toBeVisible()
    })

    it('shows Try Again button', async () => {
      const screen = await render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect
        .element(screen.getByRole('button', { name: 'Try Again' }))
        .toBeVisible()
    })

    it('shows Refresh Page button', async () => {
      const screen = await render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect
        .element(screen.getByRole('button', { name: 'Refresh Page' }))
        .toBeVisible()
    })
  })

  describe('static fallback', () => {
    it('renders static fallback element when provided', async () => {
      const screen = await render(
        <ErrorBoundary fallback={<div>Custom error page</div>}>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect.element(screen.getByText('Custom error page')).toBeVisible()
    })
  })

  describe('fallbackRender', () => {
    it('calls fallbackRender with error and reset function', async () => {
      const screen = await render(
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div>
              <p>Error: {error.message}</p>
              <button onClick={resetErrorBoundary}>Reset</button>
            </div>
          )}
        >
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      await expect
        .element(screen.getByText('Error: Test error message'))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Reset' }))
        .toBeVisible()
    })
  })

  describe('onReset callback', () => {
    it('calls onReset when reset is triggered', async () => {
      const onReset = vi.fn()
      const screen = await render(
        <ErrorBoundary onReset={onReset}>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      )
      const button = screen.getByRole('button', { name: 'Try Again' })
      await button.click()
      expect(onReset).toHaveBeenCalledTimes(1)
    })
  })
})
