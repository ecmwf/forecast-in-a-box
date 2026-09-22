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
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'
import { previewFrame, stylePreviewUrl } from '@/features/viewer/style-preview'

const LAYER: ParsedLayer = {
  name: 't2m',
  title: 't2m',
  styles: [{ name: 'sh_a' }, { name: 'ct_b' }],
}

function laeaView() {
  const view = createViewerView(getViewerProjection('laea'))
  view.setViewportSize([800, 500])
  view.setCenter([4_300_000, 3_200_000])
  view.setResolution(2000)
  return view
}

describe('style previews', () => {
  it('frames the viewport as a ≤240×200 thumbnail with a quantised extent', () => {
    const frame = previewFrame(laeaView())!
    expect(frame.size).toEqual([240, 150])
    expect(frame.extent[0]).toBeCloseTo(4_300_000 - 800_000, -4)
    // Quantised: multiples of width/200 = 8000.
    expect(
      frame.extent.every(
        (v) => Math.abs(v / 8000 - Math.round(v / 8000)) < 1e-6,
      ),
    ).toBe(true)
  })

  it('shapes the GetMap like the map: style, time and the server axis order', () => {
    const view = laeaView()
    const frame = previewFrame(view)!
    const base = {
      baseUrl: 'http://localhost:19001',
      layer: LAYER,
      settings: { style: 'ct_b' },
      time: '2026-09-04T02:00:00Z',
    }
    const epsg = new URL(
      stylePreviewUrl({ ...base, bboxAxisOrder: 'epsg' }, view, frame),
    )
    const xy = new URL(
      stylePreviewUrl({ ...base, bboxAxisOrder: 'xy' }, view, frame),
    )
    expect(epsg.pathname).toBe('/wms')
    expect(epsg.searchParams.get('STYLES')).toBe('ct_b')
    expect(epsg.searchParams.get('TIME')).toBe('2026-09-04T02:00:00Z')
    expect(epsg.searchParams.get('CRS')).toBe('EPSG:3035')
    expect(epsg.searchParams.get('WIDTH')).toBe('240')
    // EPSG order swaps to northing-first; Magics servers keep x,y.
    const [e0, e1] = epsg.searchParams.get('BBOX')!.split(',').map(Number)
    const [x0, x1] = xy.searchParams.get('BBOX')!.split(',').map(Number)
    expect(e0).toBeCloseTo(x1, 3)
    expect(e1).toBeCloseTo(x0, 3)
  })
})
