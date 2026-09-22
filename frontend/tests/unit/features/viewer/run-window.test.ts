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
import type {
  LayerRequestSettings,
  ParsedLayer,
} from '@/features/viewer/wms-capabilities'
import {
  beforeRunLayers,
  mergeEpochLayers,
} from '@/features/viewer/geo/run-window'

const T = (iso: string) => Date.parse(iso)
const layer = (name: string, raw: string): ParsedLayer => ({
  name,
  title: name,
  styles: [],
  time: { raw },
})

describe('beforeRunLayers', () => {
  const layers = [
    layer('msl', '2026-09-03T00:00:00Z/2026-09-03T18:00:00Z/PT6H'),
    layer('2t', '2026-09-03T00:00:00Z/2026-09-03T18:00:00Z/PT6H'),
  ]
  it('marks advertised steps before the pinned run, per layer', () => {
    const settings = new Map<string, LayerRequestSettings>([
      ['msl', { dims: { reference_time: '2026-09-03T12:00:00Z' } }],
    ])
    const out = beforeRunLayers(layers, ['msl', '2t'], settings)
    expect([...out.keys()]).toEqual([
      T('2026-09-03T00:00:00Z'),
      T('2026-09-03T06:00:00Z'),
    ])
    expect(out.get(T('2026-09-03T00:00:00Z'))).toEqual(['msl'])
  })
  it('is empty without a pinned run, for inactive layers, or garbage runs', () => {
    const settings = new Map<string, LayerRequestSettings>([
      ['msl', { dims: { reference_time: 'yesterday' } }],
      ['2t', { dims: { reference_time: '2026-09-03T12:00:00Z' } }],
    ])
    expect(beforeRunLayers(layers, ['msl'], settings).size).toBe(0)
    expect(beforeRunLayers(layers, [], settings).size).toBe(0)
  })
})

describe('mergeEpochLayers', () => {
  it('unions names per epoch without duplicates and keeps inputs', () => {
    const a = new Map([[1, ['x']]])
    const b = new Map([
      [1, ['x', 'y']],
      [2, ['z']],
    ])
    const out = mergeEpochLayers(a, b)
    expect(out.get(1)).toEqual(['x', 'y'])
    expect(out.get(2)).toEqual(['z'])
    expect(a.get(1)).toEqual(['x'])
    expect(mergeEpochLayers(a, new Map())).toBe(a)
  })
})
