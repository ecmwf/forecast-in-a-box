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
import {
  decodeViewerUrlState,
  encodeViewerUrlState,
} from '@/features/viewer/geo/view-url-state'

describe('encodeViewerUrlState', () => {
  it('round-trips the full slim state', () => {
    const encoded = encodeViewerUrlState({
      layersA: ['2t', 'msl'],
      layersB: ['2t'],
      unlinkedLayers: true,
      timeMs: 1_751_781_600_000,
      timeLink: 'offset',
      offsetMs: 21_600_000,
      camera: { lon: 13.4, lat: 52.5, zoom: 5.25 },
      basemap: 'positron',
    })
    expect(encoded).toEqual({
      la: '2t,msl',
      lb: '2t',
      ul: true,
      t: 1_751_781_600_000,
      tl: 'offset',
      dt: 21_600_000,
      cam: '13.40,52.50,5.25',
      bm: 'positron',
    })
    expect(decodeViewerUrlState(encoded)).toEqual({
      layersA: ['2t', 'msl'],
      layersB: ['2t'],
      unlinkedLayers: true,
      timeMs: 1_751_781_600_000,
      timeLink: 'offset',
      offsetMs: 21_600_000,
      camera: { lon: 13.4, lat: 52.5, zoom: 5.25 },
      basemap: 'positron',
    })
  })

  it('omits defaults so a plain view keeps a clean URL', () => {
    const encoded = encodeViewerUrlState({
      layersA: [],
      layersB: [],
      unlinkedLayers: false,
      timeLink: 'exact',
      offsetMs: 0,
    })
    expect(Object.values(encoded).every((v) => v === undefined)).toBe(true)
  })

  it('drops dt unless the link mode is offset', () => {
    expect(
      encodeViewerUrlState({ timeLink: 'nearest', offsetMs: 3_600_000 }).dt,
    ).toBeUndefined()
  })

  it('caps stacks at 12 names and drops comma-bearing ones', () => {
    const names = Array.from({ length: 20 }, (_, i) => `layer_${i}`)
    const encoded = encodeViewerUrlState({ layersA: ['bad,name', ...names] })
    expect(encoded.la!.split(',')).toHaveLength(12)
    expect(encoded.la).not.toContain('bad')
  })

  it('wraps a dateline-crossed longitude back into range', () => {
    expect(
      encodeViewerUrlState({ camera: { lon: 200, lat: 10, zoom: 3 } }).cam,
    ).toBe('-160.00,10.00,3.00')
  })
})

describe('decodeViewerUrlState', () => {
  it('rejects malformed or out-of-range cameras', () => {
    for (const cam of ['junk', '1,2', '10,99,3', '10,20,99', '1,2,NaN']) {
      expect(decodeViewerUrlState({ cam }).camera).toBeUndefined()
    }
  })

  it('ignores an offset without offset mode', () => {
    expect(
      decodeViewerUrlState({ tl: 'nearest', dt: 3_600_000 }).offsetMs,
    ).toBeUndefined()
  })

  it('treats empty strings as absent', () => {
    const state = decodeViewerUrlState({ la: '', cam: '' })
    expect(state.layersA).toBeUndefined()
    expect(state.camera).toBeUndefined()
  })
})

describe('projection param', () => {
  it('round-trips a known projection id and drops unknown ones', () => {
    const encoded = encodeViewerUrlState({ projection: 'npole' })
    expect(encoded.p).toBe('npole')
    expect(decodeViewerUrlState(encoded).projection).toBe('npole')
    expect(
      decodeViewerUrlState({ p: 'EPSG:3857' as never }).projection,
    ).toBeUndefined()
    expect(encodeViewerUrlState({}).p).toBeUndefined()
  })
})

describe('styles (sa/sb) aligned with the layer lists', () => {
  it('round-trips styles, trims trailing defaults, drops all-default', () => {
    const encoded = encodeViewerUrlState({
      layersA: ['2t', 'msl', 'tp'],
      stylesA: [null, 'ct_blk', null],
      layersB: ['2t'],
      stylesB: [null],
    })
    expect(encoded.sa).toBe(',ct_blk')
    expect(encoded.sb).toBeUndefined()
    const decoded = decodeViewerUrlState(encoded)
    expect(decoded.layersA).toEqual(['2t', 'msl', 'tp'])
    expect(decoded.stylesA).toEqual([null, 'ct_blk', null])
    expect(decoded.stylesB).toBeUndefined()
  })

  it('keeps alignment when a comma-bearing name is dropped', () => {
    const encoded = encodeViewerUrlState({
      layersA: ['bad,name', 'msl'],
      stylesA: ['x', 'ct_blk'],
    })
    expect(encoded.la).toBe('msl')
    expect(encoded.sa).toBe('ct_blk')
    // A style with a comma falls back to the default.
    expect(
      encodeViewerUrlState({ layersA: ['msl'], stylesA: ['a,b'] }).sa,
    ).toBeUndefined()
  })

  it('tolerates legacy links without styles and stray style entries', () => {
    expect(decodeViewerUrlState({ la: '2t,msl' }).stylesA).toBeUndefined()
    expect(decodeViewerUrlState({ la: '2t', sa: 'x,y,z' }).stylesA).toEqual([
      'x',
    ])
  })
})

describe('runs (ra/rb) aligned with the layer lists', () => {
  it('round-trips pinned runs independently of styles', () => {
    const encoded = encodeViewerUrlState({
      layersA: ['2t', 'msl'],
      stylesA: ['ct_red', null],
      runsA: [null, '2026-09-04T00:00:00Z'],
    })
    expect(encoded.sa).toBe('ct_red')
    expect(encoded.ra).toBe(',2026-09-04T00:00:00Z')
    const decoded = decodeViewerUrlState(encoded)
    expect(decoded.stylesA).toEqual(['ct_red', null])
    expect(decoded.runsA).toEqual([null, '2026-09-04T00:00:00Z'])
    expect(decoded.runsB).toBeUndefined()
  })
})
