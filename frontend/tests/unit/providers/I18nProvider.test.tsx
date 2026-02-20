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
import { I18nProvider } from '@/providers/I18nProvider'

// Mock I18nextProvider to verify it's used correctly
vi.mock('react-i18next', () => ({
  I18nextProvider: ({
    children,
    i18n,
  }: {
    children: React.ReactNode
    i18n: unknown
  }) => (
    <div data-testid="i18next-provider" data-has-i18n={!!i18n}>
      {children}
    </div>
  ),
}))

// Mock the i18n instance
vi.mock('@/lib/i18n', () => ({
  default: { language: 'en' },
}))

describe('I18nProvider', () => {
  it('renders children', async () => {
    const screen = await render(
      <I18nProvider>
        <div data-testid="child">Child Content</div>
      </I18nProvider>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('wraps children with I18nextProvider', async () => {
    const screen = await render(
      <I18nProvider>
        <div>Content</div>
      </I18nProvider>,
    )

    await expect
      .element(screen.getByTestId('i18next-provider'))
      .toBeInTheDocument()
  })

  it('passes i18n instance to I18nextProvider', async () => {
    const screen = await render(
      <I18nProvider>
        <div>Content</div>
      </I18nProvider>,
    )

    const provider = screen.getByTestId('i18next-provider')
    expect(provider.element().getAttribute('data-has-i18n')).toBe('true')
  })

  it('renders multiple children', async () => {
    const screen = await render(
      <I18nProvider>
        <div data-testid="first">First</div>
        <div data-testid="second">Second</div>
      </I18nProvider>,
    )

    await expect.element(screen.getByTestId('first')).toBeInTheDocument()
    await expect.element(screen.getByTestId('second')).toBeInTheDocument()
  })
})
