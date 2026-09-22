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
import View from 'ol/View'
import { get as getProjection, transform } from 'ol/proj'
import { containsExtent, getCenter } from 'ol/extent'
import {
  PROJECTIONS,
  carryCamera,
  getViewerProjection,
  groundResolution,
  homeExtentFor,
  layerExtentFor,
  registerViewerProjections,
  requestProjection,
  viewResolutionFor,
  viewerProjectionOf,
} from '@/features/viewer/projections'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import {
  PROJECTION_IDS,
  isProjectionId,
} from '@/features/viewer/projection-ids'

registerViewerProjections()

describe('projection registry', () => {
  it('registers every proj4-backed code with extent and world extent', () => {
    registerViewerProjections() // idempotent
    for (const p of PROJECTIONS) {
      const olProj = getProjection(p.code)
      expect(olProj, p.code).not.toBeNull()
      expect(olProj!.getExtent()).toBeTruthy()
      expect(olProj!.getWorldExtent()).toBeTruthy()
    }
  })

  it('places the poles at the UPS false origin', () => {
    expect(transform([0, 90], 'EPSG:4326', 'EPSG:32661')[0]).toBeCloseTo(2e6, 0)
    expect(transform([0, 90], 'EPSG:4326', 'EPSG:32661')[1]).toBeCloseTo(2e6, 0)
    expect(transform([0, -90], 'EPSG:4326', 'EPSG:32761')[1]).toBeCloseTo(
      2e6,
      0,
    )
    // Home extents frame the pole with margin, inside the navigable extent.
    for (const id of ['npole', 'spole'] as const) {
      const p = getViewerProjection(id)
      expect(containsExtent(p.extent, p.homeExtent)).toBe(true)
      expect(getCenter(p.homeExtent)).toEqual([2e6, 2e6])
    }
  })

  it('registers projected codes northing-first with an easting-first twin', () => {
    const view = createViewerView(getViewerProjection('laea'))
    expect(view.getProjection().getAxisOrientation()).toBe('neu')
    // Compliant servers get the view projection itself (OL swaps the BBOX).
    expect(requestProjection(view, 'epsg')).toBeUndefined()
    const twin = requestProjection(view, 'xy')!
    expect(twin.getCode()).toBe('EPSG:3035')
    expect(twin.getAxisOrientation()).toBe('enu')
    expect(requestProjection(view, 'xy')).toBe(twin) // cached
    // Built-ins keep OL's behaviour for every server.
    expect(
      requestProjection(createViewerView(getViewerProjection('geo')), 'xy'),
    ).toBeUndefined()
    expect(
      requestProjection(createViewerView(getViewerProjection('merc')), 'xy'),
    ).toBeUndefined()
  })

  it('exposes the toolbar order and validates ids', () => {
    expect(PROJECTIONS.map((p) => p.id)).toEqual([...PROJECTION_IDS])
    expect(isProjectionId('npole')).toBe(true)
    expect(isProjectionId('EPSG:3857')).toBe(false)
    expect(getViewerProjection(undefined).id).toBe('merc')
    expect(viewerProjectionOf(new View({ projection: 'EPSG:4326' })).id).toBe(
      'geo',
    )
    expect(viewerProjectionOf(new View({ projection: 'EPSG:32661' })).id).toBe(
      'npole',
    )
  })
})

describe('createViewerView', () => {
  it('lets a wide viewport reach both poles in Equirectangular', () => {
    const view = createViewerView(getViewerProjection('geo'))
    const size: [number, number] = [2000, 980]
    view.fit([-180, -90, 180, 90], { size })
    const shown = view.calculateExtent(size)
    expect(shown[1]).toBeLessThanOrEqual(-90)
    expect(shown[3]).toBeGreaterThanOrEqual(90)
  })

  it('keeps Mercator filling the window (no void)', () => {
    const view = createViewerView(getViewerProjection('merc'))
    const size: [number, number] = [2000, 980]
    view.fit(getViewerProjection('merc').extent, { size })
    const shown = view.calculateExtent(size)
    const world = getViewerProjection('merc').extent
    expect(shown[1]).toBeGreaterThanOrEqual(world[1] - 1)
    expect(shown[3]).toBeLessThanOrEqual(world[3] + 1)
  })
})

describe('carryCamera', () => {
  it('keeps the ground scale within 5% and the centre in place', () => {
    const from = createViewerView(getViewerProjection('merc'))
    from.setCenter(transform([20, 65], 'EPSG:4326', 'EPSG:3857'))
    from.setResolution(2000)
    const target = getViewerProjection('npole')
    const to = createViewerView(target)
    carryCamera(from, to, target)
    const back = transform(to.getCenter()!, 'EPSG:32661', 'EPSG:4326')
    expect(back[0]).toBeCloseTo(20, 3)
    expect(back[1]).toBeCloseTo(65, 3)
    const before = groundResolution(from)!
    const after = groundResolution(to)!
    expect(Math.abs(after - before) / before).toBeLessThan(0.05)
  })

  it('falls back to the pole when the centre leaves the target extent', () => {
    const from = createViewerView(getViewerProjection('merc'))
    from.setCenter(transform([0, -40], 'EPSG:4326', 'EPSG:3857'))
    from.setResolution(5000)
    const target = getViewerProjection('npole')
    const to = createViewerView(target)
    carryCamera(from, to, target)
    expect(to.getCenter()).toEqual([2e6, 2e6])
  })

  it('round-trips a metre band through view units', () => {
    const view = createViewerView(getViewerProjection('geo'))
    view.setCenter([10, 50])
    view.setResolution(0.5)
    const metres = groundResolution(view)!
    expect(viewResolutionFor(view, metres)).toBeCloseTo(0.5, 4)
  })
})

describe('homeExtentFor', () => {
  it('ignores global and pole-crossing bboxes for polar views', () => {
    const npole = getViewerProjection('npole')
    expect(homeExtentFor(npole, [-180, -90, 180, 90])).toBe(npole.homeExtent)
    expect(homeExtentFor(npole, [-180, -55, 180, 85])).toBe(npole.homeExtent)
    expect(homeExtentFor(npole, null)).toBe(npole.homeExtent)
  })

  it('fits a regional bbox inside the coverage', () => {
    const npole = getViewerProjection('npole')
    const extent = homeExtentFor(npole, [-10, 55, 40, 75])
    expect(extent).not.toBe(npole.homeExtent)
    expect(containsExtent(npole.extent, extent)).toBe(true)
    expect(extent.every(Number.isFinite)).toBe(true)
  })

  it('keeps Mercator behaviour: the WGS84 bbox transformed', () => {
    const merc = getViewerProjection('merc')
    const extent = homeExtentFor(merc, [-10, 40, 10, 60])
    expect(extent[0]).toBeCloseTo(-1113194.9, 0)
    expect(homeExtentFor(merc, null)).toBe(merc.homeExtent)
  })
})

describe('layerExtentFor', () => {
  it('keeps the projection extent for global, dateline and pole cases', () => {
    const merc = getViewerProjection('merc')
    const npole = getViewerProjection('npole')
    expect(layerExtentFor(merc, undefined)).toBe(merc.extent)
    expect(layerExtentFor(merc, [-180, -90, 180, 90])).toBe(merc.extent)
    expect(layerExtentFor(merc, [170, 40, -170, 60])).toBe(merc.extent)
    expect(layerExtentFor(npole, [-180, -55, 180, 85])).toBe(npole.extent)
  })

  it('clips a regional bbox to the projection world', () => {
    const merc = getViewerProjection('merc')
    const extent = layerExtentFor(merc, [-10, 40, 10, 60])
    expect(extent[0]).toBeCloseTo(-1113194.9, 0)
    expect(extent[2]).toBeCloseTo(1113194.9, 0)
    expect(containsExtent(merc.extent, extent)).toBe(true)
    const npole = getViewerProjection('npole')
    expect(
      containsExtent(npole.extent, layerExtentFor(npole, [-10, 55, 40, 75])),
    ).toBe(true)
  })
})
