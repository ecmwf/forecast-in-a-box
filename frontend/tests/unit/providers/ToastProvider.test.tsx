/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ToastProvider } from '@/providers/ToastProvider'

// Mock sonner's Toaster component
vi.mock('sonner', () => ({
  Toaster: ({
    position,
    richColors,
    closeButton,
    duration,
  }: {
    position: string
    richColors: boolean
    closeButton: boolean
    duration: number
  }) => (
    <div
      data-testid="toaster"
      data-position={position}
      data-rich-colors={richColors}
      data-close-button={closeButton}
      data-duration={duration}
    >
      Toaster
    </div>
  ),
}))

describe('ToastProvider', () => {
  it('renders children', async () => {
    const screen = await render(
      <ToastProvider>
        <div data-testid="child">Child Content</div>
      </ToastProvider>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('renders Toaster component', async () => {
    const screen = await render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    )

    await expect.element(screen.getByTestId('toaster')).toBeInTheDocument()
  })

  it('configures Toaster with correct position', async () => {
    const screen = await render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    )

    const toaster = screen.getByTestId('toaster')
    expect(toaster.element().getAttribute('data-position')).toBe('top-right')
  })

  it('configures Toaster with richColors enabled', async () => {
    const screen = await render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    )

    const toaster = screen.getByTestId('toaster')
    expect(toaster.element().getAttribute('data-rich-colors')).toBe('true')
  })

  it('configures Toaster with closeButton enabled', async () => {
    const screen = await render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    )

    const toaster = screen.getByTestId('toaster')
    expect(toaster.element().getAttribute('data-close-button')).toBe('true')
  })

  it('configures Toaster with 5000ms duration', async () => {
    const screen = await render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    )

    const toaster = screen.getByTestId('toaster')
    expect(toaster.element().getAttribute('data-duration')).toBe('5000')
  })

  it('renders multiple children', async () => {
    const screen = await render(
      <ToastProvider>
        <div data-testid="first">First</div>
        <div data-testid="second">Second</div>
      </ToastProvider>,
    )

    await expect.element(screen.getByTestId('first')).toBeInTheDocument()
    await expect.element(screen.getByTestId('second')).toBeInTheDocument()
  })
})
