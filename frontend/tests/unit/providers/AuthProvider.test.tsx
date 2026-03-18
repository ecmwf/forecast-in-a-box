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
import { AuthProvider } from '@/providers/AuthProvider'

// Mock the feature auth provider
vi.mock('@/features/auth/AuthProvider.tsx', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="feature-auth-provider">{children}</div>
  ),
}))

describe('AuthProvider', () => {
  it('renders children', async () => {
    const screen = await render(
      <AuthProvider>
        <div data-testid="child">Child Content</div>
      </AuthProvider>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('wraps children with FeatureAuthProvider', async () => {
    const screen = await render(
      <AuthProvider>
        <span>Test</span>
      </AuthProvider>,
    )

    await expect
      .element(screen.getByTestId('feature-auth-provider'))
      .toBeInTheDocument()
  })

  it('passes children through to FeatureAuthProvider', async () => {
    const screen = await render(
      <AuthProvider>
        <div data-testid="nested">Nested Content</div>
      </AuthProvider>,
    )

    const featureProvider = screen.getByTestId('feature-auth-provider')
    const nested = screen.getByTestId('nested')

    await expect.element(featureProvider).toBeInTheDocument()
    await expect.element(nested).toBeInTheDocument()
    expect(featureProvider.element().contains(nested.element())).toBe(true)
  })
})
