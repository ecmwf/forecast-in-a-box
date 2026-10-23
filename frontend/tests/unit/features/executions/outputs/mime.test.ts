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
import { canonicalMime, mimeParam } from '@/features/executions/outputs/mime'
import { isGribDirMime } from '@/features/executions/outputs/adapters/grib'

const GRIB_OLD = 'text/plain; fiab-format=gribdir'
const GRIB_NEW = 'text/plain; fiab-format=gribdir; fiab-fetchable=1'
const ZARR = 'text/plain; fiab-format=zarr; fiab-fetchable=1'

describe('mimeParam', () => {
  it('reads a parameter regardless of spacing and key case', () => {
    expect(mimeParam(GRIB_NEW, 'fiab-format')).toBe('gribdir')
    expect(mimeParam('text/plain;FIAB-FORMAT= gribdir ', 'fiab-format')).toBe(
      'gribdir',
    )
  })

  it('returns undefined for a missing parameter or bare type', () => {
    expect(mimeParam(GRIB_OLD, 'fiab-fetchable')).toBeUndefined()
    expect(mimeParam('image/png', 'fiab-format')).toBeUndefined()
  })
})

describe('canonicalMime', () => {
  it('keeps the base type and fiab-format only', () => {
    expect(canonicalMime(GRIB_NEW)).toBe(GRIB_OLD)
    expect(canonicalMime('text/plain; charset=utf-8')).toBe('text/plain')
    expect(canonicalMime('IMAGE/PNG')).toBe('image/png')
  })
})

describe('isGribDirMime', () => {
  it('matches markers from before and after the fetchable flag', () => {
    expect(isGribDirMime(GRIB_OLD)).toBe(true)
    expect(isGribDirMime(GRIB_NEW)).toBe(true)
  })

  it('rejects other formats and missing mimes', () => {
    expect(isGribDirMime(ZARR)).toBe(false)
    expect(isGribDirMime('text/plain')).toBe(false)
    expect(isGribDirMime(undefined)).toBe(false)
  })
})
