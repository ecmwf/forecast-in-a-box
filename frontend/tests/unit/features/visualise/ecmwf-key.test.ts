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
  ecmwfPublicUrl,
  keyTail,
  withEcmwfKey,
} from '@/features/visualise/ecmwf-key'
import { styleScope } from '@/stores/stylePinsStore'

const PUBLIC = 'https://eccharts.ecmwf.int/wms/?token=public'
const KEY = '8ea0123456789abcdef0123456789abc'

describe('withEcmwfKey', () => {
  it('swaps the public token for the key', () => {
    expect(withEcmwfKey(PUBLIC, KEY)).toBe(
      `https://eccharts.ecmwf.int/wms/?token=${KEY}`,
    )
  })

  it('keys a token-less ecCharts URL too', () => {
    expect(withEcmwfKey('https://eccharts.ecmwf.int/wms/', KEY)).toBe(
      `https://eccharts.ecmwf.int/wms/?token=${KEY}`,
    )
  })

  it('leaves a pasted private token, other hosts and no key alone', () => {
    const pasted = 'https://eccharts.ecmwf.int/wms/?token=theirs'
    expect(withEcmwfKey(pasted, KEY)).toBe(pasted)
    const dwd = 'https://maps.dwd.de/geoserver/ows?'
    expect(withEcmwfKey(dwd, KEY)).toBe(dwd)
    expect(withEcmwfKey(PUBLIC, null)).toBe(PUBLIC)
    expect(withEcmwfKey('not a url', KEY)).toBe('not a url')
  })
})

describe('ecmwfPublicUrl', () => {
  it('folds a keyed URL back to the public one', () => {
    expect(ecmwfPublicUrl(withEcmwfKey(PUBLIC, KEY))).toBe(PUBLIC)
    expect(ecmwfPublicUrl('https://maps.dwd.de/geoserver/ows?')).toBe(
      'https://maps.dwd.de/geoserver/ows?',
    )
  })

  it('keeps style pins shared between the public and keyed server', () => {
    expect(styleScope(withEcmwfKey(PUBLIC, KEY))).toBe(styleScope(PUBLIC))
  })
})

describe('keyTail', () => {
  it('exposes only the last four characters', () => {
    expect(keyTail(KEY)).toBe('9abc')
  })
})
