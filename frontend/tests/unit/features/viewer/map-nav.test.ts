/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'
import { navEaseMs, zoomView } from '@/features/viewer/geo/map-nav'

const reducedMotion = (matches: boolean) =>
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches } as MediaQueryList)

describe('map nav', () => {
  afterEach(() => vi.restoreAllMocks())

  it('eases a press, at once under reduced motion', () => {
    const view = createViewerView(getViewerProjection('merc'))
    view.setZoom(3)
    reducedMotion(false)
    expect(navEaseMs()).toBeGreaterThan(0)
    zoomView(view, 1)
    expect(view.getAnimating()).toBe(true)

    view.cancelAnimations()
    view.setZoom(3)
    reducedMotion(true)
    expect(navEaseMs()).toBe(0)
    zoomView(view, 1)
    expect(view.getZoom()).toBeCloseTo(4, 6)
  })
})
