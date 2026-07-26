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

const realMatchMedia = window.matchMedia

/** Stand-in for the OS preference whose value the test can flip. */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  window.matchMedia = () => query as unknown as MediaQueryList
  return {
    flip(next: boolean) {
      dark = next
      listeners.forEach((fn) => fn())
    },
    listenerCount: () => listeners.size,
  }
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset document classes
    document.documentElement.classList.remove('light', 'dark')
    // Reset store to default state
    useUiStore.setState({ theme: 'system' })
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
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
    useUiStore.setState({ theme: 'light', resolvedTheme: 'light' })

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
    useUiStore.setState({ theme: 'dark', resolvedTheme: 'dark' })

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
    useUiStore.setState({ theme: 'light', resolvedTheme: 'light' })

    const { rerender } = await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('light')).toBe(true)

    // Change to dark theme
    useUiStore.setState({ theme: 'dark', resolvedTheme: 'dark' })

    await rerender(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('points the theme-color meta at the resolved theme', async () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '#000000')
    document.head.appendChild(meta)

    try {
      useUiStore.setState({ theme: 'dark', resolvedTheme: 'dark' })
      const { rerender } = await render(
        <ThemeProvider>
          <div>Content</div>
        </ThemeProvider>,
      )
      expect(meta.getAttribute('content')).toBe('#09090b')

      useUiStore.setState({ theme: 'light', resolvedTheme: 'light' })
      await rerender(
        <ThemeProvider>
          <div>Content</div>
        </ThemeProvider>,
      )
      expect(meta.getAttribute('content')).toBe('#ffffff')
    } finally {
      meta.remove()
    }
  })

  it('renders without a theme-color meta present', async () => {
    // The tag is absent in tests that mount the provider standalone.
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull()
    useUiStore.setState({ theme: 'dark', resolvedTheme: 'dark' })

    await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows the OS while the choice is system', async () => {
    const query = stubMatchMedia(false)
    useUiStore.setState({ theme: 'system', resolvedTheme: 'light' })

    await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('light')).toBe(true)

    query.flip(true)

    await vi.waitFor(() =>
      expect(document.documentElement.classList.contains('dark')).toBe(true),
    )
    expect(useUiStore.getState().resolvedTheme).toBe('dark')
  })

  it('ignores the OS once a theme is chosen explicitly', async () => {
    const query = stubMatchMedia(false)
    useUiStore.setState({ theme: 'light', resolvedTheme: 'light' })

    await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )

    query.flip(true)

    expect(useUiStore.getState().resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('stops listening once unmounted', async () => {
    const query = stubMatchMedia(false)
    useUiStore.setState({ theme: 'system', resolvedTheme: 'light' })

    const { unmount } = await render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    )
    expect(query.listenerCount()).toBe(1)

    unmount()
    expect(query.listenerCount()).toBe(0)
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
