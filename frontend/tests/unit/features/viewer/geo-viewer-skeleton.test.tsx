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
import { render } from 'vitest-browser-react'
import { GeoViewerSkeleton } from '@/features/viewer/geo/GeoViewerSkeleton'
// Real strings for the startup pill.
import '@/lib/i18n'

describe('GeoViewerSkeleton', () => {
  it('announces the loading state and previews the viewer layout', async () => {
    const screen = await render(<GeoViewerSkeleton label="Loading layers…" />)

    await expect
      .element(screen.getByRole('status', { name: 'Loading layers…' }))
      .toBeVisible()
    // Toolbar strip, two sidebars, map, timeline — pulsing placeholders.
    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(10)
    expect(document.querySelectorAll('aside')).toHaveLength(2)
  })

  it('shows the startup steps while the lens server starts', async () => {
    const screen = await render(
      <GeoViewerSkeleton label="Starting lens server…" lensStarting />,
    )
    await expect
      .element(
        screen.getByRole('status', {
          name: 'Starting the map server — step 1 of 3',
        }),
      )
      .toBeVisible()
    // The pill replaces the plain label; the frame still announces it.
    await expect
      .element(screen.getByRole('status', { name: 'Starting lens server…' }))
      .toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Starting lens server…')
  })
})
