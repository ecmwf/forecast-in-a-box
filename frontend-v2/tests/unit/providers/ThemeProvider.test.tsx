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
import { ThemeProvider } from '@/providers/ThemeProvider'
import { useUiStore } from '@/stores/uiStore'

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset document classes
    document.documentElement.classList.remove('light', 'dark')
    // Reset store to default state
    useUiStore.setState({ theme: 'system' })
  })

  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark')
  })

  it('renders children', async () => {
    const screen = await render(
      <ThemeProvider>
        <div data-testid="child">Child Content</div>
      </ThemeProvider>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('applies light theme class to document', async () => {
    // Set resolved theme to light
    useUiStore.setState({ resolvedTheme: 'light' })

    await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applies dark theme class to document', async () => {
    // Set resolved theme to dark
    useUiStore.setState({ resolvedTheme: 'dark' })

    await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('removes previous theme class when theme changes', async () => {
    // Start with light theme
    useUiStore.setState({ resolvedTheme: 'light' })

    const { rerender } = await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('light')).toBe(true)

    // Change to dark theme
    useUiStore.setState({ resolvedTheme: 'dark' })

    await rerender(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('renders multiple children', async () => {
    const screen = await render(
      <ThemeProvider>
        <div data-testid="first">First</div>
        <div data-testid="second">Second</div>
      </ThemeProvider>,
    )

    await expect.element(screen.getByTestId('first')).toBeInTheDocument()
    await expect.element(screen.getByTestId('second')).toBeInTheDocument()
  })
})
