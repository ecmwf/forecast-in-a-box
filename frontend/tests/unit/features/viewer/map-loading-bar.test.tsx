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
import { MapLoadingBar } from '@/features/viewer/components/MapLoadingBar'

const track = () =>
  document.querySelector('[aria-hidden="true"]') as HTMLElement

describe('MapLoadingBar', () => {
  it('sweeps in the slot color while loading', async () => {
    await render(<MapLoadingBar loading slot="a" />)
    expect(track().className).toContain('opacity-100')
    const bar = track().firstElementChild as HTMLElement
    expect(bar.className).toContain('bg-blue-600')
    expect(bar.className).toContain('map-loading-sweep')
  })

  it('fades out and stops animating when idle', async () => {
    await render(<MapLoadingBar loading={false} slot="b" />)
    expect(track().className).toContain('opacity-0')
    const bar = track().firstElementChild as HTMLElement
    expect(bar.className).not.toContain('map-loading-sweep')
  })

  it('falls back to the neutral color without a slot', async () => {
    await render(<MapLoadingBar loading />)
    expect((track().firstElementChild as HTMLElement).className).toContain(
      'bg-primary',
    )
  })
})
