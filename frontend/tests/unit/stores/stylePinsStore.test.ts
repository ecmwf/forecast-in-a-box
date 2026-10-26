/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  stylePinKey,
  styleScope,
  useStylePinsStore,
} from '@/stores/stylePinsStore'

describe('stylePinsStore', () => {
  beforeEach(() => useStylePinsStore.getState().reset())

  it('pins and unpins a style per scope and layer', () => {
    const { pin, unpin, pinned } = useStylePinsStore.getState()
    pin('lens', '2t', 'sh_all_fM64t52i4')
    expect(useStylePinsStore.getState().pinned('lens', '2t')).toBe(
      'sh_all_fM64t52i4',
    )
    expect(pinned('lens', 'msl')).toBeNull()
    pin('lens', '2t', 'ct_red')
    expect(useStylePinsStore.getState().pins[stylePinKey('lens', '2t')]).toBe(
      'ct_red',
    )
    unpin('lens', '2t')
    expect(useStylePinsStore.getState().pinned('lens', '2t')).toBeNull()
  })

  it('scopes every lens run together and external servers by URL', () => {
    expect(styleScope('/api/v1/lens/proxy/abc-1')).toBe('lens')
    expect(styleScope('/api/v1/lens/proxy/def-2')).toBe('lens')
    expect(styleScope('https://eccharts.ecmwf.int/wms/?token=public')).toBe(
      'https://eccharts.ecmwf.int/wms/?token=public',
    )
  })
})
