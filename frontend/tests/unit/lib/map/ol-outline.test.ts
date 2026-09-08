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
import Graticule from 'ol/layer/Graticule'
import SimpleGeometry from 'ol/geom/SimpleGeometry'
import type VectorLayer from 'ol/layer/Vector'
import { loadOutlineData, makeOutlineBasemapLayer } from '@/lib/map/ol-outline'
import {
  getViewerProjection,
  polarGraticuleFor,
  registerViewerProjections,
} from '@/features/viewer/projections'

registerViewerProjections()

describe('makeOutlineBasemapLayer', () => {
  it('fills the coast and border sources once the lazy data resolves', async () => {
    const group = makeOutlineBasemapLayer('EPSG:3857', undefined, 'light')
    const coast = group.getLayers().getArray()[1] as VectorLayer
    await loadOutlineData()
    expect(coast.getSource()!.getFeatures().length).toBeGreaterThan(100)
  })

  it('uses the OL graticule for cylindrical views', async () => {
    await loadOutlineData()
    const group = makeOutlineBasemapLayer('EPSG:3857', undefined, 'light')
    const layers = group.getLayers().getArray()
    expect(layers).toHaveLength(3)
    expect(layers[2]).toBeInstanceOf(Graticule)
    // Coastlines reprojected: every coordinate finite.
    const coast = layers[1] as VectorLayer
    expect(coast.getSource()!.getFeatures().length).toBeGreaterThan(100)
  })

  it('builds a fixed polar graticule with ring labels', () => {
    const npole = getViewerProjection('npole')
    const group = makeOutlineBasemapLayer(
      npole.code,
      npole.extent,
      'dark',
      polarGraticuleFor(npole),
    )
    const graticule = group.getLayers().getArray()[2] as VectorLayer
    expect(graticule).not.toBeInstanceOf(Graticule)
    const features = graticule.getSource()!.getFeatures()
    const labels = features
      .map((f) => f.get('label') as string | undefined)
      .filter((l): l is string => typeof l === 'string')
    // Parallels 20°…80° and meridians every 30°.
    expect(labels).toEqual(
      expect.arrayContaining(['80° N', '20° N', '0°', '90° E', '150° W']),
    )
    expect(labels.filter((l) => l.endsWith('N'))).toHaveLength(7)
    expect(labels).toHaveLength(7 + 12)
    for (const f of features) {
      const g = f.getGeometry()
      expect(g).toBeInstanceOf(SimpleGeometry)
      expect(
        (g as SimpleGeometry).getFlatCoordinates().every(Number.isFinite),
      ).toBe(true)
    }
  })

  it('labels the southern hemisphere for the Antarctic view', () => {
    const spole = getViewerProjection('spole')
    const group = makeOutlineBasemapLayer(
      spole.code,
      spole.extent,
      'light',
      polarGraticuleFor(spole),
    )
    const graticule = group.getLayers().getArray()[2] as VectorLayer
    const labels = graticule
      .getSource()!
      .getFeatures()
      .map((f) => f.get('label') as string | undefined)
    expect(labels).toContain('80° S')
    expect(labels).not.toContain('80° N')
  })
})
