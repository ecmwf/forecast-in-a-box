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
import { render } from 'vitest-browser-react'
import {
  AppProviders,
  AuthProvider,
  I18nProvider,
  QueryProvider,
  ThemeProvider,
  ToastProvider,
} from '@/providers'

// Mock all individual providers to track render order
const renderOrder: Array<string> = []

vi.mock('@/providers/I18nProvider', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => {
    renderOrder.push('I18nProvider')
    return <div data-testid="i18n-provider">{children}</div>
  },
}))

vi.mock('@/providers/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => {
    renderOrder.push('ThemeProvider')
    return <div data-testid="theme-provider">{children}</div>
  },
}))

vi.mock('@/providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => {
    renderOrder.push('QueryProvider')
    return <div data-testid="query-provider">{children}</div>
  },
}))

vi.mock('@/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => {
    renderOrder.push('AuthProvider')
    return <div data-testid="auth-provider">{children}</div>
  },
}))

vi.mock('@/providers/ToastProvider', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => {
    renderOrder.push('ToastProvider')
    return <div data-testid="toast-provider">{children}</div>
  },
}))

describe('AppProviders', () => {
  beforeEach(() => {
    renderOrder.length = 0
  })

  it('renders children', async () => {
    const screen = await render(
      <AppProviders>
        <div data-testid="child">Child Content</div>
      </AppProviders>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('wraps children with all providers', async () => {
    const screen = await render(
      <AppProviders>
        <div>Content</div>
      </AppProviders>,
    )

    await expect
      .element(screen.getByTestId('i18n-provider'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('theme-provider'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('query-provider'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('auth-provider'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('toast-provider'))
      .toBeInTheDocument()
  })

  it('nests providers in correct order (I18n outermost)', async () => {
    const screen = await render(
      <AppProviders>
        <div data-testid="child">Content</div>
      </AppProviders>,
    )

    // I18nProvider should be outermost
    const i18nProvider = screen.getByTestId('i18n-provider')
    const themeProvider = screen.getByTestId('theme-provider')
    const queryProvider = screen.getByTestId('query-provider')
    const authProvider = screen.getByTestId('auth-provider')
    const toastProvider = screen.getByTestId('toast-provider')
    const child = screen.getByTestId('child')

    // Check nesting: I18n > Theme > Query > Auth > Toast > child
    expect(i18nProvider.element().contains(themeProvider.element())).toBe(true)
    expect(themeProvider.element().contains(queryProvider.element())).toBe(true)
    expect(queryProvider.element().contains(authProvider.element())).toBe(true)
    expect(authProvider.element().contains(toastProvider.element())).toBe(true)
    expect(toastProvider.element().contains(child.element())).toBe(true)
  })
})

describe('Provider exports', () => {
  it('exports AuthProvider', () => {
    expect(AuthProvider).toBeDefined()
    expect(typeof AuthProvider).toBe('function')
  })

  it('exports I18nProvider', () => {
    expect(I18nProvider).toBeDefined()
    expect(typeof I18nProvider).toBe('function')
  })

  it('exports QueryProvider', () => {
    expect(QueryProvider).toBeDefined()
    expect(typeof QueryProvider).toBe('function')
  })

  it('exports ThemeProvider', () => {
    expect(ThemeProvider).toBeDefined()
    expect(typeof ThemeProvider).toBe('function')
  })

  it('exports ToastProvider', () => {
    expect(ToastProvider).toBeDefined()
    expect(typeof ToastProvider).toBe('function')
  })

  it('exports AppProviders', () => {
    expect(AppProviders).toBeDefined()
    expect(typeof AppProviders).toBe('function')
  })
})
