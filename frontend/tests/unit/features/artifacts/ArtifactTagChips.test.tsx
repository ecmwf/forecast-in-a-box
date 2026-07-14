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
import { renderWithProviders } from '@tests/utils/render'
import { ArtifactTagChips } from '@/features/artifacts/components/ArtifactTagChips'

describe('ArtifactTagChips', () => {
  it('renders nothing for an empty tags record', async () => {
    const screen = await renderWithProviders(
      <div data-testid="host">
        <ArtifactTagChips tags={{}} />
      </div>,
    )
    expect(screen.getByTestId('host').element().childElementCount).toBe(0)
  })

  it('renders a bare key for a null-valued tag', async () => {
    const screen = await renderWithProviders(
      <ArtifactTagChips tags={{ ensemble: null }} />,
    )
    await expect.element(screen.getByText('ensemble')).toBeVisible()
  })

  it('renders key: value inline for short details', async () => {
    const screen = await renderWithProviders(
      <ArtifactTagChips tags={{ resolution: 'n320' }} />,
    )
    await expect.element(screen.getByText('resolution: n320')).toBeVisible()
  })

  it('keeps long details in the tooltip, label stays the key', async () => {
    const long = 'scaled dot-product attention (sdpa) variant'
    const screen = await renderWithProviders(
      <ArtifactTagChips tags={{ attention: long }} />,
    )
    const chip = screen.getByText('attention', { exact: true })
    await expect.element(chip).toBeVisible()
    expect(chip.element().getAttribute('title')).toBe(`attention: ${long}`)
  })

  it('collapses beyond max into a "+N" chip listing the rest', async () => {
    const screen = await renderWithProviders(
      <ArtifactTagChips
        tags={{ a: null, b: null, c: null, d: 'x', e: null }}
        max={3}
      />,
    )
    for (const key of ['a', 'b', 'c']) {
      await expect.element(screen.getByText(key, { exact: true })).toBeVisible()
    }
    const overflow = screen.getByText('+2')
    await expect.element(overflow).toBeVisible()
    expect(overflow.element().getAttribute('title')).toBe('d: x\ne')
    expect(screen.getByText('d: x', { exact: true }).elements()).toHaveLength(0)
  })
})
